"""Final look of a lifestyle frame (2026-11-25, owner + catalogue review):
  1. the rug's pattern and fibres from the ORIGINAL photo, its volume and light from the model: inside the rug the colour
     (chroma) and fine luminance detail come from the composite B (original pixels), the coarse luminance (sigma DETAIL_SIG)
     from the model's re-render; the fluffy outer edge stays the model's. Pattern geometry then matches the product exactly;
  2. a soft, warm 'lamp' grade with less yellow: lower contrast, lifted shadows, slight bloom, yellow pulled back - at half
     strength on the rug so its colours stay true;
  3. a tighter crop (CROP, kept centred on the rug horizontally) - the rug larger in the frame, its real size unchanged.
Prints how well the final rug's colour map matches the original (correlation of chroma inside the rug).
Usage: final_look.py final.png composite_B.png outline_alpha.png out.png
env: DETAIL_SIG 2.5, EDGE_IN 8, CONTRAST 0.92, LIFT 10, BLOOM 0.10, WB_TARGET 1,0.975,0.935, KNEE 205, RUG_KNEE 195,
     RUG_TOP 240, CROP 0.88, ORIG (the product photo placed on the same canvas, for the colour check)"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Rp, Bp, Ap, out_p = sys.argv[1:5]
R = np.asarray(Image.open(Rp).convert("RGB")).astype(float); B = np.asarray(Image.open(Bp).convert("RGB")).astype(float)
H, W = R.shape[:2]; a = np.asarray(Image.open(Ap).convert("L").resize((W, H))) > 128
e = lambda k, d: float(os.environ.get(k, d))

# 1. original pattern + fibres, model's volume + light
core = ndi.binary_erosion(a, iterations=int(e("EDGE_IN", 8)))
w = ndi.gaussian_filter(core.astype(float), 2)[..., None]
lum = lambda X: X.mean(2) + 1
sg = e("DETAIL_SIG", 2.5)
Lr, Lb = lum(R), lum(B)
Lnew = ndi.gaussian_filter(Lr, sg) * (Lb / ndi.gaussian_filter(Lb, sg))           # model's coarse light x original detail
rug = B / Lb[..., None] * Lnew[..., None]                                       # original chroma at the new luminance
X = R * (1 - w) + np.clip(rug, 0, 255) * w
chroma = lambda Y: Y / (Y.sum(2, keepdims=True) + 1)
cR, cB = chroma(R)[core], chroma(B)[core]
corr = np.mean([np.corrcoef(cR[:, k], cB[:, k])[0, 1] for k in range(3)])
print("pattern match, model re-render vs original (chroma correlation inside the rug): %.3f  (1.0 = identical)" % corr)

# 2. soft warm look, less yellow (half strength on the rug)
s = (1 - 0.5 * ndi.gaussian_filter(a.astype(float), 6))[..., None]
m = X.mean()
G = m + (X - m) * e("CONTRAST", 0.92)
G = G + e("LIFT", 10) * (1 - G / 255) ** 2
G = G + e("BLOOM", 0.10) * ndi.gaussian_filter(np.clip(G - 200, 0, None), (18, 18, 0))
X = X * (1 - s) + G * s
# neutral white balance: bright, low-saturation pixels outside the rug (walls, ceiling, curtains) go to a barely warm white
sat = (X.max(2) - X.min(2)) / (X.max(2) + 1); Lx = X.mean(2)
ref = (~ndi.binary_dilation(a, iterations=30)) & (sat < 0.22) & (Lx > np.percentile(Lx, 70)) & (Lx < 245)
TGT = np.array([float(v) for v in os.environ.get("WB_TARGET", "1.0,0.975,0.935").split(",")])
mean = X[ref].mean(0); gain_wb = (TGT / TGT.mean()) / (mean / mean.mean())
print("white balance: neutral areas were %s -> gains %s" % (np.round(mean / mean.mean(), 3), np.round(gain_wb, 3)))
X = X * gain_wb
# no blown highlights: soft shoulder above KNEE, the rug capped lower so its wool keeps texture
def shoulder(v, knee, top):
    over = np.clip(v - knee, 0, None); return np.where(v > knee, knee + (top - knee) * (1 - np.exp(-over / (top - knee))), v)
X = shoulder(X, e("KNEE", 205), 250)
ar = ndi.gaussian_filter(a.astype(float), 3)[..., None]
X = X * (1 - ar) + shoulder(X, e("RUG_KNEE", 195), e("RUG_TOP", 240)) * ar
print("clipped pixels (>=250): %.2f%% of the frame, rug max %.0f" % (100 * (X.max(2) >= 250).mean(), X[a].max()))
# colour check against the original photo (the composite B carries the original pixels with the room's light)
def stats(Y, msk):
    c = Y[msk]; s_ = (c.max(1) - c.min(1)) / (c.max(1) + 1); base = c[s_ < 0.15]
    return (np.median(base, 0) / np.median(base, 0).mean()) if len(base) else np.ones(3)
if os.environ.get("ORIG"):                                            # the product photo as cut out (RGBA), its own outline
    Oi = Image.open(os.environ["ORIG"]).convert("RGBA").resize((W, H)); O = np.asarray(Oi.convert("RGB")).astype(float)
    om = ndi.binary_erosion(np.asarray(Oi.split()[3]) > 128, iterations=int(e("EDGE_IN", 8)))
else:
    O, om = B, core
so, sf = stats(O, om), stats(X, core)
if os.environ.get("MATCH_BASE", "1") == "1":       # the rug's base colour back to the photo's (the grade + model light turned it greenish)
    X = X * (1 - ar) + X * (so / sf) * ar
    print("rug base colour matched to the photo: gains %s" % np.round(so / sf, 3)); sf = stats(X, core)
print("rug cream base, chroma (R,G,B normalised): original photo %s  final %s  (max difference %.3f)"
      % (np.round(so, 3), np.round(sf, 3), np.abs(so - sf).max()))
def pal(Y, msk):                                                         # the pattern's colours: the saturated pixels' median
    c = Y[msk]; s_ = (c.max(1) - c.min(1)) / (c.max(1) + 1); p = c[s_ > 0.35]
    return np.median(p / p.mean(1, keepdims=True), 0) if len(p) else np.ones(3)
print("pattern colours, chroma: original photo %s  final %s" % (np.round(pal(O, om), 3), np.round(pal(X, core), 3)))

# 3. tighter crop around the rug
c = e("CROP", 0.88); cw, ch = int(W * c), int(H * c)
ys, xs = np.nonzero(a); cx = int(np.clip(xs.mean() - cw / 2, 0, W - cw)); cy = int(np.clip(H - ch - (H - ys.max()) * 0.35, 0, H - ch))
img = Image.fromarray(X.clip(0, 255).astype(np.uint8)).crop((cx, cy, cx + cw, cy + ch)).resize((W, H), Image.LANCZOS)
img.save(out_p); print("crop %.0f%% -> rug %.0f%% larger in the frame, saved %s" % (100 * c, 100 * (1 / c - 1), out_p))
