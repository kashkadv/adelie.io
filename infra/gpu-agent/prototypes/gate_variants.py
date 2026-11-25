"""Hard gates for FLOOR products, detector + arithmetic only (no AI judgement). Per variant prints:
  align   - structure correlation of the original product and the model frame inside the mask (pattern kept?)
  rugs    - other rug-like boxes (GroundingDINO "a rug.") that are not the product itself: a second rug drawn by the model
  scale   - sofa box width / product width in the image; for a product lying parallel to the sofa the expected value is
            sofa_cm / product_side_cm (EXPECT env), accepted within +-25 %
  verdict - ok / reason(s)
Usage: gate_variants.py cutout_canvas.png v1.png [v2 ...]   env: EXPECT (e.g. 1.1), ALIGN_MIN (0.45)"""
import os, sys
import numpy as np, torch
from PIL import Image
from scipy import ndimage as ndi
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

EXPECT = float(os.environ.get("EXPECT", 0)); ALIGN_MIN = float(os.environ.get("ALIGN_MIN", 0.45))
proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
det = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny").to("cuda").eval()
cut = Image.open(sys.argv[1]).convert("RGBA")

def boxes(im, text, thr=0.3):
    with torch.no_grad():
        inp = proc(images=im, text=text, return_tensors="pt").to("cuda")
        r = proc.post_process_grounded_object_detection(det(**inp), inp.input_ids, threshold=thr, text_threshold=0.25,
                                                        target_sizes=[im.size[::-1]])[0]
    return [(b.cpu().numpy(), float(s)) for b, s in zip(r["boxes"], r["scores"])]

def iou(a, b):
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x1 - x0) * max(0, y1 - y0); u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / max(u, 1)

for p in sys.argv[2:]:
    im = Image.open(p).convert("RGB"); W, H = im.size
    c = cut.resize((W, H), Image.LANCZOS); a = np.asarray(c.split()[3]) > 128
    ys, xs = np.nonzero(a); pb = np.array([xs.min(), ys.min(), xs.max(), ys.max()], float)
    core = ndi.binary_erosion(a, iterations=max(2, W // 200))
    g = lambda x: (lambda y: np.hypot(ndi.sobel(y, 0), ndi.sobel(y, 1)))(ndi.gaussian_filter(np.asarray(x.convert("L")).astype(float), 1.5))
    g1, g2 = g(c)[core], g(im)[core]
    align = float(((g1 - g1.mean()) / (g1.std() + 1e-6) * (g2 - g2.mean()) / (g2.std() + 1e-6)).mean())
    pw_, ph_ = pb[2] - pb[0], pb[3] - pb[1]
    def other(b):           # a rug box that is not the product: elsewhere, or reaching beyond the product (a bigger rug under it)
        if (b[2] - b[0]) * (b[3] - b[1]) < 0.15 * pw_ * ph_: return False
        beyond = max(pb[0] - b[0], b[2] - pb[2]) / pw_ > 0.04 or max(pb[1] - b[1], b[3] - pb[3]) / ph_ > 0.04
        return iou(b, pb) < 0.6 or beyond
    extra = [b for b, s in boxes(im, "a rug.") if other(b)]
    sofas = boxes(im, "a sofa.")
    scale = None
    if sofas:
        sb = max(sofas, key=lambda t: t[1])[0]; scale = (sb[2] - sb[0]) / (pb[2] - pb[0])
    why = []
    # the model must keep the mock-up room: its sofa box vs the proxy's sofa block (PROXY_SOFA="x0,y0,x1,y1" in the frame of
    # the cutout canvas, scaled to this image); a different camera moves and resizes the sofa
    if os.environ.get("PROXY_SOFA") and sofas:
        px = np.array([float(v) for v in os.environ["PROXY_SOFA"].split(",")]) * np.array([W, H, W, H]) / np.array(cut.size * 2)
        sb = max(sofas, key=lambda t: t[1])[0]
        dev = max(abs(sb[0] - px[0]), abs(sb[2] - px[2]), abs(sb[3] - px[3])) / (px[2] - px[0])
        if dev > float(os.environ.get("PROXY_TOL", 0.2)): why.append("room changed (%.2f)" % dev)
    if align < ALIGN_MIN: why.append("pattern changed")
    if extra: why.append("second rug")
    if EXPECT and (scale is None or not (0.75 * EXPECT <= scale <= 1.25 * EXPECT)): why.append("scale")
    print("%-22s align %.2f  rugs+%d  scale %s  %s" % (p.split("/")[-1], align, len(extra), "-" if scale is None else "%.2f" % scale,
                                                    "ok" if not why else ", ".join(why)))
