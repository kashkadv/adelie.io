"""Removes a smooth matting 'haze' around a product (light floor taken for soft fringe) and keeps real fringe/fibres.
Fringe is strand-like (alpha changes sharply between neighbours); haze is a smooth semi-transparent patch. Pixels farther than
10 px from the solid body whose local alpha texture is smooth (std in a 9 px window < 0.08) fade out.
Usage: dehaze_alpha.py cutout.png out.png"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, dst = sys.argv[1:3]
im = Image.open(src).convert("RGBA"); a = np.asarray(im.split()[3]) / 255.0
dist = ndi.distance_transform_edt(~(a > 0.9))
mean = ndi.uniform_filter(a, 9); std = np.sqrt(np.clip(ndi.uniform_filter(a * a, 9) - mean ** 2, 0, None))
smooth = np.clip((0.08 - std) / 0.04, 0, 1)                 # 1 = smooth patch, 0 = strands
far = np.clip((dist - 10) / 10, 0, 1)                       # only beyond 10 px from the body
keep = 1 - ndi.gaussian_filter(smooth * far, 2)
a2 = a * np.clip(keep, 0, 1)
out = np.dstack([np.asarray(im)[..., :3], (a2 * 255).astype(np.uint8)])
Image.fromarray(out, "RGBA").save(dst)
print("alpha removed: %.2f%% of the frame" % ((a - a2).clip(0).sum() / a.size * 100))
