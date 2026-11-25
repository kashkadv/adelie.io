"""Removes the old background's colour from the cutout edge (a grey outline of concrete around a light product).
The photo background colour is measured right outside the product; edge pixels (within EDGE px of the transparent area)
that are close to that colour lose their alpha. White fringe and the product's own colours stay.
Usage: decontaminate_edge.py photo.png cutout_full_frame.png out.png"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

photo_p, cut_p, out_p = sys.argv[1:4]
EDGE = int(os.environ.get("EDGE", 12)); TOL = float(os.environ.get("TOL", 45))
ph = np.asarray(Image.open(photo_p).convert("RGB")).astype(float)
cut = Image.open(cut_p).convert("RGBA"); c = np.asarray(cut).astype(float); a = c[..., 3] / 255
H, W = a.shape
ring = ndi.binary_dilation(a > 0.05, iterations=60) & ~ndi.binary_dilation(a > 0.05, iterations=15)
bg = np.median(ph[ring], axis=0)
edge = ndi.distance_transform_edt(a > 0.05) <= EDGE
d = np.linalg.norm(c[..., :3] - bg, axis=2)
contam = np.clip(1 - d / TOL, 0, 1) * edge
contam = np.maximum(contam, ndi.grey_dilation(contam, size=3) * edge * 0.7)     # grey edge pixels come in short runs
a2 = a * (1 - contam)
out = c.copy(); out[..., 3] = a2 * 255
Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA").save(out_p)
print("background colour", bg.round(), "edge pixels cleaned: %d" % (contam > 0.5).sum())
