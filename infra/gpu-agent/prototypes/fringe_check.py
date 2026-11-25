"""Does the product have a fringe, and did the cut-out keep it? (owner, 2026-11-26: a fringe seen on any photo of the product
must end up in the frame even when the main photo's cut-out lost it - white fringe on a white backdrop)
  - GroundingDINO looks for 'fringe' / 'tassels' on every photo in the product folder;
  - on the main photo it also checks whether the cut-out's alpha actually covers the found fringe boxes.
Prints one decision line the recipe reads:  FRINGE yes|no  KEPT yes|no  CM <length or ->
Usage: fringe_check.py <product folder> <main photo name> <cut-out RGBA of the main photo> [body long side, cm]"""
import sys
from pathlib import Path
import numpy as np, torch
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

folder, main, cut_p = Path(sys.argv[1]), sys.argv[2], sys.argv[3]; LONG = float(sys.argv[4]) if len(sys.argv) > 4 else 0
dev = "cuda" if torch.cuda.is_available() else "cpu"
P = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
M = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny").to(dev).eval()
TH = 0.30

def find(im, text="fringe. tassels."):
    with torch.no_grad():
        inp = P(images=im, text=text, return_tensors="pt").to(dev)
        r = P.post_process_grounded_object_detection(M(**inp), inp.input_ids, threshold=TH, text_threshold=0.25,
                                                     target_sizes=[im.size[::-1]])[0]
    return [(float(s), [float(v) for v in b]) for s, b in zip(r["scores"], r["boxes"])]

seen = {}
for f in sorted(folder.iterdir()):
    if f.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"): continue
    im = Image.open(f).convert("RGB"); im.thumbnail((1280, 1280)); hits = find(im)
    seen[f.name] = (max([s for s, _ in hits], default=0), hits, im.size)
    print("  %-28s fringe %s" % (f.name, "%.2f" % seen[f.name][0] if hits else "-"))
fringe = any(v[0] >= TH for v in seen.values())

kept, cm = "no", "-"
if fringe and main in seen:
    cut = Image.open(cut_p).convert("RGBA"); a = np.asarray(cut.split()[3]) / 255.0; _, hits, sz = seen[main]
    sx, sy = a.shape[1] / sz[0], a.shape[0] / sz[1]
    cover = [a[int(b[1] * sy):int(b[3] * sy) + 1, int(b[0] * sx):int(b[2] * sx) + 1].mean() for _, b in hits]
    kept = "yes" if cover and max(cover) > 0.35 else "no"
    if hits and LONG:                                   # fringe length from the main photo: box depth vs the body's long side
        rows = np.nonzero(a.sum(1) > 0.9 * a.sum(1).max())[0]; body_px = (np.ptp(rows) + 1) / sy
        depth = np.median([min(b[3] - b[1], b[2] - b[0]) for _, b in hits])
        cm = "%.0f" % float(np.clip(depth / body_px * LONG, 2, 15))
print("FRINGE %s  KEPT %s  CM %s" % ("yes" if fringe else "no", kept, cm))
