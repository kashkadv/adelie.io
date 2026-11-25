"""Final step of the 'new interior' recipe: ORIGINAL product pixels + the light of the AI frame.
Inputs (all the same framing as the product photo):
  base.png     - the AI room with the original product pasted over it (no relight)
  relit.png    - a light klein pass over base.png (START=3 of 8, prompt_harm.txt): the model lights the product like the room;
                 its pattern stays in place, so it can serve as a light map
  cutout.png   - full-frame RGBA cutout of the product from the photo
Per colour channel, the ratio relit/base is blurred INSIDE the product (sigma 8 px, gain 0.6..1.8) and applied to the original
pixels: the sun edge, the warm cast and the contact shade come from the model, every fibre and the pattern from the photo.
Around the product (60 px, soft) the relit frame is taken as is (its contact shadow and bounce).
Usage: relight_paste.py base.png relit.png cutout.png out.png"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

base_p, relit_p, cut_p, out_p = sys.argv[1:5]
base = Image.open(base_p).convert("RGB"); W, H = base.size
relit = Image.open(relit_p).convert("RGB").resize((W, H), Image.LANCZOS)
cut = Image.open(cut_p).convert("RGBA").resize((W, H), Image.LANCZOS)
a = np.asarray(cut.split()[3]) / 255.0; m = (a > 0.5).astype(float)
B = np.asarray(base).astype(float); R = np.asarray(relit).astype(float)
mblur = lambda x, s: ndi.gaussian_filter(x * m, s) / (ndi.gaussian_filter(m, s) + 1e-6)
ratio = np.stack([np.clip((mblur(R[..., c], 8) + 6) / (mblur(B[..., c], 8) + 6), 0.6, 1.8) for c in range(3)], -1)
ring = ndi.gaussian_filter(ndi.binary_dilation(m > 0, iterations=60).astype(float), 20)
out = B * (1 - ring[..., None]) + R * ring[..., None]
out = out * (1 - a[..., None]) + np.clip(B * ratio, 0, 255) * a[..., None]
Image.fromarray(out.astype(np.uint8)).save(out_p); print("saved", out_p)
