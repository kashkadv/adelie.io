"""Final blend for light / flat products where a pasted edge always shows a seam: the model's own frame stays everywhere
OUTSIDE and at the very EDGE of the product (its contact shade, its edge and fringe are consistent with the room), and the
ORIGINAL product pixels, relit by the model's light (per channel, blurred inside the product), take over a few px inside the
edge. Pattern and texture of the body come from the photo; there is one edge only, so no halo and no 'sandwich'.
Env: SIG (light blur, px, default 12), IN0/IN1 (fade starts/ends this many px inside the edge, default 3/15).
Usage: blend_into_model.py model_frame.png cutout_full_frame.png out.png"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

frame_p, cut_p, out_p = sys.argv[1:4]
SIG = float(os.environ.get("SIG", 12)); IN0 = float(os.environ.get("IN0", 3)); IN1 = float(os.environ.get("IN1", 15))
M = np.asarray(Image.open(frame_p).convert("RGB")).astype(float); H, W = M.shape[:2]
cut = Image.open(cut_p).convert("RGBA").resize((W, H), Image.LANCZOS)
O = np.asarray(cut.convert("RGB")).astype(float); a = np.asarray(cut.split()[3]) / 255.0
body = a > 0.5; m = body.astype(float)
mblur = lambda x: ndi.gaussian_filter(x * m, SIG) / (ndi.gaussian_filter(m, SIG) + 1e-6)
ratio = np.stack([np.clip((mblur(M[..., c]) + 6) / (mblur(O[..., c]) + 6), 0.5, 1.8) for c in range(3)], -1)
relit = np.clip(O * ratio, 0, 255)
d = ndi.distance_transform_edt(body)
w = (np.clip((d - IN0) / (IN1 - IN0), 0, 1) * a)[..., None]
out = M * (1 - w) + relit * w
Image.fromarray(out.astype(np.uint8)).save(out_p); print("saved", out_p)
