"""Stage 1: a text prompt -> GroundingDINO box -> SAM2 mask of just that object. Writes mask PNGs and a visual check."""
import sys, time
import numpy as np, torch
from pathlib import Path
from PIL import Image, ImageDraw
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, Sam2Model, Sam2Processor

base = Path.home() / "ComfyUI"; out = base / "output/etap0"
dev = "cuda"
t = time.time()
dino_p = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
dino = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny").to(dev).eval()
sam_p = Sam2Processor.from_pretrained("facebook/sam2.1-hiera-small")
sam = Sam2Model.from_pretrained("facebook/sam2.1-hiera-small").to(dev).eval()
print("models loaded %.1fs" % (time.time() - t))

def one_mask(im, prompt):
    with torch.no_grad():
        inp = dino_p(images=im, text=prompt, return_tensors="pt").to(dev)
        res = dino_p.post_process_grounded_object_detection(dino(**inp), inp.input_ids, threshold=0.25, text_threshold=0.2,
                                                           target_sizes=[im.size[::-1]])[0]
    if len(res["boxes"]) == 0:
        print("   nothing found for", repr(prompt)); return None, None
    order = res["scores"].argsort(descending=True)
    box = res["boxes"][order[0]].cpu().tolist()
    print("  ", repr(prompt), "-> box", [round(v) for v in box], "score %.2f" % float(res["scores"][order[0]]))
    with torch.no_grad():
        sin = sam_p(images=im, input_boxes=[[box]], return_tensors="pt").to(dev)
        so = sam(**sin, multimask_output=True)
        masks = sam_p.post_process_masks(so.pred_masks.cpu(), sin["original_sizes"].cpu())[0]
    cands = masks.reshape(-1, *masks.shape[-2:]).numpy().astype(bool)
    bw, bh = box[2] - box[0], box[3] - box[1]
    ok = []
    for k, c in enumerate(cands):
        ys, xs = np.where(c)
        if len(xs) and xs.min() >= box[0] - 0.03 * bw and xs.max() <= box[2] + 0.03 * bw \
                and ys.min() >= box[1] - 0.03 * bh and ys.max() <= box[3] + 0.03 * bh:
            ok.append((c.sum(), k))
    k = max(ok)[1] if ok else 0
    print("   candidates cover", [round(float(100 * c.mean()), 1) for c in cands], "%% -> chose #%d" % k)
    return cands[k], box

for spec in sys.argv[1:]:
    name, prompts = spec.split("=", 1)
    im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB"); im.thumbnail((1500, 1500))
    print(name)
    m = np.zeros((im.height, im.width), bool); boxes = []
    for prompt in prompts.split("|"):
        mk, bx = one_mask(im, prompt)
        if mk is not None:
            m |= mk; boxes.append(bx)
    if not boxes:
        continue
    m8 = m.astype(np.uint8) * 255
    Image.fromarray(m8).save(out / f"{name}_sam_mask.png")
    over = np.asarray(im).astype(np.float64); tint = np.array([220, 30, 60], dtype=np.float64)
    over[m] = over[m] * 0.45 + tint * 0.55
    vis = Image.fromarray(over.astype(np.uint8))
    for bx in boxes:
        ImageDraw.Draw(vis).rectangle(bx, outline=(255, 255, 0), width=4)
    vis.thumbnail((1000, 1000)); vis.save(out / f"{name}_sam_check.jpg", quality=88)
    print("   united mask covers %.1f%% of the frame" % (100 * m.mean()))
