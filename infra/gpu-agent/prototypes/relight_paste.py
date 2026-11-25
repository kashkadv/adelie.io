"""Final step of the 'new interior' recipe: ORIGINAL product pixels + the light of the AI frame.
Inputs (all the same framing as the product photo):
  base.png     - the AI room with the original product pasted over it (no relight)
  relit.png    - a light klein pass over base.png (START=3 of 8, prompt_harm.txt): the model lights the product like the room;
                 its pattern stays in place, so it can serve as a light map
  cutout.png   - full-frame RGBA cutout of the product from the photo
Per colour channel, the ratio relit/base is blurred INSIDE the product (sigma 8 px, gain 0.6..1.8) and applied to the original
pixels: the sun edge, the warm cast and the contact shade come from the model, every fibre and the pattern from the photo.
Everything outside the product is taken from the relit frame as is: the floor's light and the product's light must come from
ONE pass, otherwise the sun stripes on the floor and on the product do not line up.
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
prod = np.clip(B * ratio, 0, 255)
# grounding, no AI: (1) a thin contact shadow along the whole contour - the blurred silhouette darkens the
# floor right at the edge and under the fringe, so the floor light never seems to pass "under" the product
contact = ndi.gaussian_filter((a > 0.4).astype(float), 2.0)
floor = R * (1 - 0.4 * contact[..., None] * np.array([1.0, 1.04, 1.1]))   # a warm-brown shade, not grey
# (2) rim light: fibres within ~14 px of the edge brighten (warm) by up to 30 % where the floor right outside them is sunlit
inner = ndi.distance_transform_edt(a > 0.5)
band = np.clip(1 - inner / 14.0, 0, 1) * np.clip((a - 0.5) * 2, 0, 1)   # dense fibres only, not the see-through fringe
lumR = R.mean(axis=2); outside = (a < 0.05).astype(float)
near = ndi.gaussian_filter(lumR * outside, 10) / (ndi.gaussian_filter(outside, 10) + 1e-6)
p50, p97 = np.percentile(lumR[a < 0.05], 50), np.percentile(lumR[a < 0.05], 97)
sunlit = np.clip((near - p50) / (p97 - p50 + 1e-6), 0, 1)
rim = 0.30 * band * sunlit
prod = np.clip(prod * (1 + rim[..., None] * np.array([1.0, 0.9, 0.7])), 0, 255)
# (3) fringe colour: see-through fibres still carry the colour of the photo's old background (a greenish/grey outline);
# they take the colour of the dense fibres next to them, their shape (alpha) stays
dense = (a > 0.85).astype(float)
near_col = np.stack([ndi.gaussian_filter(prod[..., c] * dense, 4) / (ndi.gaussian_filter(dense, 4) + 1e-6) for c in range(3)], -1)
fr = np.clip((0.85 - a) / 0.6, 0, 1)[..., None]
prod = prod * (1 - fr) + near_col * fr
out =floor * (1 - a[..., None]) + prod * a[..., None]
Image.fromarray(out.astype(np.uint8)).save(out_p); print("saved", out_p)
