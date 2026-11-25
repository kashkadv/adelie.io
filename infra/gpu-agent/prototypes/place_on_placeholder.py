"""Puts the real product on the grey placeholder the model lit (see placeholder_base.py).
  light  = the model's grey slab / its known grey: brightness only (blur SIG px inside the slab, clamp GMIN..GMAX) and one
           overall colour of the light (limited to +-CAST) - the product's own colours stay;
  floor  = the slab plus a thin band around it repainted by LaMa from the surrounding floor only, so no grey shows through the
           product's fluffy edge; the model's shadow farther around the slab stays;
  result = floor * (1 - alpha) + original product * light * alpha.
Usage: place_on_placeholder.py frame.png cutout_canvas.png out.png   env: GREY 150, SIG 6, GMIN 0.55, GMAX 1.25, CAST 0.08"""
import os, sys
from pathlib import Path
import numpy as np, torch
from PIL import Image
from scipy import ndimage as ndi

frame_p, cut_p, out_p = sys.argv[1:4]
GREY = float(os.environ.get("GREY", 150)); SIG = float(os.environ.get("SIG", 6))
GMIN, GMAX = float(os.environ.get("GMIN", 0.55)), float(os.environ.get("GMAX", 1.25)); CAST = float(os.environ.get("CAST", 0.08))
F = np.asarray(Image.open(frame_p).convert("RGB")).astype(float); H, W = F.shape[:2]
cut = Image.open(cut_p).convert("RGBA").resize((W, H), Image.LANCZOS)
O = np.asarray(cut.convert("RGB")).astype(float); a = np.asarray(cut.split()[3]) / 255.0
slab = a > 0.5; s = W / 1200
inner = ndi.binary_erosion(slab, iterations=max(2, int(4 * s)))       # the slab without its edge (the model's edge shading)
m = inner.astype(float)
mblur = lambda x: ndi.gaussian_filter(x * m, SIG * s) / (ndi.gaussian_filter(m, SIG * s) + 1e-6)
lumF = F.mean(axis=2)
L = mblur(lumF) / GREY
# outside the inner slab (edge, fringe) the light continues from the nearest slab pixel
idx = ndi.distance_transform_edt(~inner, return_distances=False, return_indices=True)
L = L[idx[0], idx[1]]
gain = np.clip(L, GMIN, GMAX)
col = F[inner].mean(0); col = col / col.mean()                         # colour of the light falling on the grey slab
cast = np.clip(col, 1 - CAST, 1 + CAST)
prod = np.clip(O * gain[..., None] * cast, 0, 255)
# floor under the product: repaint the slab + a thin band from the floor around it (LaMa sees the floor only)
hole = ndi.binary_dilation(slab | (a > 0.05), iterations=max(6, int(int(os.environ.get('BAND', 18)) * s)))   # wide enough to swallow the model's dark rim around the grey slab
lama = torch.jit.load(str(Path.home() / "ComfyUI/models/lama/big-lama.pt"), map_location="cuda").eval()
ys, xs = np.nonzero(hole); mg = int(80 * s)
y0, y1, x0, x1 = max(0, ys.min() - mg), min(H, ys.max() + mg), max(0, xs.min() - mg), min(W, xs.max() + mg)
crop, mk = F[y0:y1, x0:x1] / 255, hole[y0:y1, x0:x1]
h, w = mk.shape; ph, pw = (-h) % 8, (-w) % 8
img = np.pad(crop.transpose(2, 0, 1), ((0, 0), (0, ph), (0, pw)), mode="reflect")
mm = np.pad(mk.astype(np.float32)[None], ((0, 0), (0, ph), (0, pw)), mode="reflect")
with torch.inference_mode():
    res = lama(torch.from_numpy(img).float()[None].cuda(), (torch.from_numpy(mm)[None].cuda() > 0).float())
fill = res[0].permute(1, 2, 0).cpu().numpy()[:h, :w].clip(0, 1) * 255
floor = F.copy(); floor[y0:y1, x0:x1][mk] = fill[mk]
# keep the model's contact shade right at the slab edge: darken the repainted floor by the shade the model drew there
edge = ndi.binary_dilation(slab, iterations=max(3, int(8 * s))) & ~slab
ref = ndi.binary_dilation(slab, iterations=max(6, int(24 * s))) & ~ndi.binary_dilation(slab, iterations=max(4, int(14 * s)))
if edge.any() and ref.any():
    # a soft warm contact shade under the product edge, strength from the model's own shade at the slab edge (capped)
    k = np.clip(lumF[edge].mean() / max(lumF[ref].mean(), 1), 0.75, 1.0)
    shade = ndi.gaussian_filter((a > 0.3).astype(float), 3 * s) * (1 - (a > 0.3)) * (1 - k) * 1.5
    floor *= (1 - shade[..., None] * np.array([1.0, 1.05, 1.12]))
out = floor * (1 - a[..., None]) + prod * a[..., None]
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(out_p)
print("light gain %.2f..%.2f, light colour %s, saved %s" % (gain[slab].min(), gain[slab].max(), np.round(cast, 3), out_p))
