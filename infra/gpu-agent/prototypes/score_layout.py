"""Ranks generated variants of a FLOOR product in a room - detector boxes and arithmetic only, no AI judgement.
  centre: the sofa must stand on the product's short axis. The product's long axis u comes from its mask (PCA); the sofa's
          floor point (bottom centre of its box) is projected on u: |offset| / product length. 0 = centred.
  junk:   share of the floor right around the product (4-110 px; floor reference 170-260 px) that does not look like the floor farther away
          (an extra rug, a thicker edge the model drew) - see clean_leftover.py.
  cut:    the sofa touches the frame edge.
score = centre + 2 * junk + 0.25 * cut; lower is better.
Usage: score_layout.py cutout_full_frame.png "a sofa." variant1.png [variant2.png ...]"""
import sys
import numpy as np, torch
from PIL import Image
from scipy import ndimage as ndi
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

cut_p, furniture = sys.argv[1], sys.argv[2]
dev = "cuda"
proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
det = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny").to(dev).eval()
alpha = Image.open(cut_p).convert("RGBA").split()[3]
rows = []
for p in sys.argv[3:]:
    im = Image.open(p).convert("RGB"); W, H = im.size; s = W / 816
    a = np.asarray(alpha.resize((W, H))) > 128
    ys, xs = np.nonzero(a); c = np.array([xs.mean(), ys.mean()])
    P = np.stack([xs - c[0], ys - c[1]], 1); ev, vec = np.linalg.eigh(P.T @ P / len(P)); u = vec[:, -1]
    length = np.ptp(P @ u)
    F = np.asarray(im).astype(float) / 255; lum = F.mean(2) + 1e-4; chroma = F / lum[..., None]
    near = ndi.binary_dilation(a, iterations=int(110 * s)) & ~ndi.binary_dilation(a, iterations=int(4 * s))
    ref = ndi.binary_dilation(a, iterations=int(260 * s)) & ~ndi.binary_dilation(a, iterations=int(170 * s))
    mu = np.median(chroma[ref], 0); dev_ = np.median(np.abs(chroma[ref] - mu), 0) + 0.01
    odd = (np.abs((chroma - mu) / dev_).max(2) > 6) | (lum < 0.4 * np.median(lum[ref]))
    junk = odd[near].mean()
    with torch.no_grad():
        inp = proc(images=im, text=furniture, return_tensors="pt").to(dev)
        r = proc.post_process_grounded_object_detection(det(**inp), inp.input_ids, threshold=0.3, text_threshold=0.25,
                                                        target_sizes=[(H, W)])[0]
    if len(r["boxes"]) == 0:
        rows.append((9.0, p, "no " + furniture)); continue
    b = r["boxes"][r["scores"].argmax()].cpu().numpy()
    foot = np.array([(b[0] + b[2]) / 2, b[3]])
    centre = abs((foot - c) @ u) / length
    cut = float(b[0] < 0.01 * W or b[2] > 0.99 * W)
    score = centre + 2 * junk + 0.25 * cut
    rows.append((score, p, "centre %.3f junk %.3f cut %d" % (centre, junk, cut)))
for sc, p, info in sorted(rows):
    print("%.3f  %s  %s" % (sc, p.split("/")[-1], info))
