"""Puts the ORIGINAL product pixels back over an AI-edited frame and gives them the frame's large-scale light.
The AI frame must keep the product in place (FLUX.2 klein started from the photo itself, START=1 of 8 steps).
Only low frequencies of brightness are transferred (blur inside the product, sigma 60 px, gain clamped 0.8..1.3),
so the pattern and every fibre stay those of the photo.
Usage: relight_paste.py ai_frame.png cutout_full_frame.png out.png"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

frame, cut_path, out = sys.argv[1:4]
g = Image.open(frame).convert("RGB"); W, H = g.size
cut = Image.open(cut_path).convert("RGBA").resize((W, H), Image.LANCZOS)   # same framing as the photo -> plain resize
a = np.asarray(cut.split()[3]) / 255.0
o = np.asarray(cut.convert("RGB")).astype(float); G = np.asarray(g).astype(float)
lum = lambda x: 0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2]
m = (a > 0.5).astype(float)
mblur = lambda x, s: ndi.gaussian_filter(x * m, s) / (ndi.gaussian_filter(m, s) + 1e-6)   # the floor does not leak in
ratio = np.clip((mblur(lum(G), 60) + 8) / (mblur(lum(o), 60) + 8), 0.8, 1.3)
res = G * (1 - a[..., None]) + np.clip(o * ratio[..., None], 0, 255) * a[..., None]
Image.fromarray(res.astype(np.uint8)).save(out); print("saved", out)
