"""Prepares the MAIN reference for a new interior: the product stays exactly where it is in the photo, everything else becomes
a plain warm backdrop (cream above the product, light wood tone below its top edge, a soft blur between them). Nothing of the
old room (walls, corner lines, concrete texture) is left for the model to turn into extra objects such as a second rug.
Usage: neutral_base.py photo.png cutout_full_frame.png out.png"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

photo_p, cut_p, out_p = sys.argv[1:4]
ph = Image.open(photo_p).convert("RGB"); W, H = ph.size
cut = Image.open(cut_p).convert("RGBA").resize((W, H), Image.LANCZOS)
a = np.asarray(cut.split()[3]) / 255.0
ys = np.nonzero(a > 0.5)[0]; top = ys.min()
wall, floor = np.array([236, 226, 210.0]), np.array([214, 184, 146.0])
t = np.clip((np.arange(H) - (top - 0.15 * H)) / (0.15 * H), 0, 1)[:, None, None]
bg = wall * (1 - t) + floor * t
bg = bg * np.ones((H, W, 1))
rng = np.random.default_rng(0); bg += ndi.gaussian_filter(rng.normal(0, 6, (H, W, 1)), (1.2, 1.2, 0))   # a little grain
out = Image.fromarray(bg.clip(0, 255).astype(np.uint8)).convert("RGBA"); out.alpha_composite(cut)
out.convert("RGB").save(out_p); print("saved", out_p)
