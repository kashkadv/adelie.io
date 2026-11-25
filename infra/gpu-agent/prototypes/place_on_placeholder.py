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
# light of the ROOM: the floor around the product, heavily blurred (boards and knots gone), extended under the product.
# Its gradient gives the light direction (for the shadow) and a smooth ramp of light across the product.
ringF = ndi.binary_dilation(slab, iterations=int(160 * s)) & ~ndi.binary_dilation(slab, iterations=int(25 * s))
rf = ringF.astype(float); SB = 70 * s
Lroom = ndi.gaussian_filter(lumF * rf, SB) / (ndi.gaussian_filter(rf, SB) + 1e-6)
ramp = Lroom / Lroom[slab].mean()
gy_, gx_ = np.gradient(ndi.gaussian_filter(Lroom, SB))
lv = np.array([gx_[slab].mean(), gy_[slab].mean()]); LDIR = lv / (np.linalg.norm(lv) + 1e-9)   # towards the light (x, y)
RAMP = float(os.environ.get("RAMP", 0.8))
gain = np.clip(L * ramp ** RAMP, GMIN, GMAX)
print("room light comes from (x %.2f, y %.2f), ramp over the product %.2f..%.2f" % (LDIR[0], LDIR[1], ramp[slab].min(), ramp[slab].max()))
col = F[inner].mean(0); col = col / col.mean()                         # colour of the light falling on the grey slab
cast = np.clip(col, 1 - CAST, 1 + CAST)
prod = np.clip(O * gain[..., None] * cast, 0, 255)
# edge against a white halo: the sparse fibres of the edge still carry the photo's light backdrop (cream on cream cannot be
# separated by colour). Thin them (alpha ** EDGE_GAMMA where the product is see-through) and shade them like fibres that lie
# next to the floor (darker towards the outer tip).
EG = float(os.environ.get("EDGE_GAMMA", 1.8)); ED = float(os.environ.get("EDGE_DARK", 0.3))
fr = a < 0.97
a = np.where(fr, a ** EG, a)
prod = prod * (1 - ED * (1 - a))[..., None]
# floor under the product: repaint the slab + a thin band from the floor around it (LaMa sees the floor only)
hole = ndi.binary_dilation(slab | (a > 0.05), iterations=max(6, int(int(os.environ.get('BAND', 18)) * s)))   # wide enough to swallow the model's dark rim around the grey slab
def lama_fill(F, hole):
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
    out = F.copy(); out[y0:y1, x0:x1][mk] = fill[mk]; return out

def boards_fill(F, hole):
    """Floor boards: continue the floor ALONG its own direction (seams and grain stay straight) - each hole pixel takes the
    nearest floor pixels in both directions along the dominant orientation of the floor texture around the hole."""
    ring = ndi.binary_dilation(hole, iterations=int(60 * s)) & ~hole
    g = ndi.gaussian_filter(F.mean(2), 1.5); gy, gx = np.gradient(g); wt = ring.astype(float)
    Jxx, Jyy, Jxy = (gx * gx * wt).sum(), (gy * gy * wt).sum(), (gx * gy * wt).sum()
    th = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy); dx, dy = -np.sin(th), np.cos(th)       # along the boards
    need = hole & (a < 0.995)
    ys, xs = np.nonzero(need); acc = np.zeros((len(ys), 3)); wsum = np.zeros(len(ys))
    for sign in (1, -1):
        px, py = xs.astype(float), ys.astype(float); alive = np.ones(len(ys), bool)
        for step in range(1, int(400 * s)):
            px += sign * dx; py += sign * dy
            ix, iy = np.round(px).astype(int), np.round(py).astype(int)
            alive &= (ix >= 0) & (iy >= 0) & (ix < W) & (iy < H)
            ixc, iyc = np.clip(ix, 0, W - 1), np.clip(iy, 0, H - 1)
            hit = alive & ~hole[iyc, ixc]
            acc[hit] += F[iyc[hit], ixc[hit]] / step; wsum[hit] += 1 / step; alive &= ~hit
            if not alive.any(): break
    out = F.copy(); ok = wsum > 0
    out[ys[ok], xs[ok]] = acc[ok] / wsum[ok, None]
    left = need.copy(); left[ys[ok], xs[ok]] = False
    if left.any(): out = lama_fill(out, left)
    print("floor fill along the boards at %.0f deg" % np.degrees(np.arctan2(dy, dx)))
    return out

floor = boards_fill(F, hole) if os.environ.get("FILL", "boards") == "boards" else lama_fill(F, hole)
# contact shade: the product's silhouette, softly blurred and nudged away from the light, darkens the floor at the edge and
# behind the see-through fringe (warm-brown, not grey)
CON = float(os.environ.get("CONTACT", 0.35))
sil = ndi.gaussian_filter((a > 0.3).astype(float), 4 * s)
SHIFT = float(os.environ.get('SHADOW_SHIFT', 6))
sil = ndi.shift(sil, (-LDIR[1] * SHIFT * s, -LDIR[0] * SHIFT * s), order=1)   # away from the room's light
shade = np.clip(sil * (1 - 0.6 * a), 0, 1) * CON
floor = floor * (1 - shade[..., None] * np.array([1.0, 1.06, 1.15]))
out = floor * (1 - a[..., None]) + prod * a[..., None]
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(out_p)
print("light gain %.2f..%.2f, light colour %s, saved %s" % (gain[slab].min(), gain[slab].max(), np.round(cast, 3), out_p))
