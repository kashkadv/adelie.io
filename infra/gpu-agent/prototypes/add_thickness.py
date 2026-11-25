"""Gives a flat product seen at an angle a visible edge: the front and side faces of the pile, THICK_CM high, drawn as darker,
softer copies of the product's own edge pixels, shifted DOWN on the canvas by the projected height (camera above the floor
-> vertical edges project downward). Usage: add_thickness.py cut_canvas.png out.png   env: THICK_PX (px, default 10)"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, dst = sys.argv[1:3]; T = int(os.environ.get("THICK_PX", 10))
cut = Image.open(src).convert("RGBA"); c = np.asarray(cut).astype(float); a = c[..., 3] / 255
rgb = c[..., :3]
layer = np.zeros_like(c)
for k in range(T, 0, -1):                                   # from the bottom of the edge up to the top surface
    sh = np.roll(np.roll(c, k, axis=0), 0, axis=1)
    shade = 0.55 + 0.35 * (1 - k / T)                       # darker towards the floor
    sa = sh[..., 3:4] / 255
    rgbk = sh[..., :3] * shade
    layer[..., :3] = rgbk * sa + layer[..., :3] * (1 - sa)
    layer[..., 3:4] = np.maximum(layer[..., 3:4], sh[..., 3:4])
out = layer.copy()
out[..., :3] = rgb * a[..., None] + layer[..., :3] * (1 - a[..., None])
out[..., 3] = np.maximum(c[..., 3], layer[..., 3])
Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA").save(dst); print("thickness", T, "px ->", dst)
