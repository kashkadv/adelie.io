"""'Placeholder' main image (owner's idea, 2026-11-25): the model never sees the product. In its exact place and silhouette
(real size, chosen angle) lies a plain matte mid-grey slab on a neutral backdrop; the model builds the room around it and
lights it. Known albedo -> whatever the model paints on the slab is pure light and shade of the room (I = A * L), which is
then applied to the real product (place_on_placeholder.py). No product for the model to redraw -> no pattern drift.
Usage: placeholder_base.py cutout_canvas.png out_main.png [grey 0..255, default 150]"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

cut_p, out_p = sys.argv[1:3]; GREY = float(sys.argv[3]) if len(sys.argv) > 3 else 150
cut = Image.open(cut_p).convert("RGBA"); W, H = cut.size
a = np.asarray(cut.split()[3]) / 255.0
slab = ndi.gaussian_filter((a > 0.5).astype(float), 1.0)              # crisp silhouette of the product body, no fringe
top = np.nonzero(a > 0.5)[0].min()
wall, floor = np.array([236, 226, 210.0]), np.array([214, 184, 146.0])
t = np.clip((np.arange(H) - (top - 0.15 * H)) / (0.15 * H), 0, 1)[:, None, None]
bg = (wall * (1 - t) + floor * t) * np.ones((H, W, 1))
bg += ndi.gaussian_filter(np.random.default_rng(0).normal(0, 6, (H, W, 1)), (1.2, 1.2, 0))
img = bg * (1 - slab[..., None]) + GREY * slab[..., None]
Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(out_p); print("saved", out_p)
