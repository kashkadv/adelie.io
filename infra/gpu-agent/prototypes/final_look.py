"""Final look of a lifestyle frame (2026-11-25, owner + catalogue review):
  1. the rug's pattern and fibres from the ORIGINAL photo, its volume and light from the model: inside the rug the colour
     (chroma) and fine luminance detail come from the composite B (original pixels), the coarse luminance (sigma DETAIL_SIG)
     from the model's re-render; the fluffy outer edge stays the model's. Pattern geometry then matches the product exactly;
  2. a soft, warm 'lamp' grade with less yellow: lower contrast, lifted shadows, slight bloom, yellow pulled back - at half
     strength on the rug so its colours stay true;
  3. a tighter crop (CROP, kept centred on the rug horizontally) - the rug larger in the frame, its real size unchanged.
Prints how well the final rug's colour map matches the original (correlation of chroma inside the rug).
Usage: final_look.py final.png composite_B.png outline_alpha.png out.png
env: DETAIL_SIG 2.5, EDGE_IN 8, CONTRAST 0.92, LIFT 10, BLOOM 0.10, YELLOW 0.5, CROP 0.88"""
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
yb = e("YELLOW", 0.5)                                                            # pull the blue back up vs red/green
yel = np.clip((G[..., :2].mean(2) - G[..., 2]) / 255, 0, None)[..., None]
G = G + yb * 40 * yel * np.array([-0.15, -0.05, 1.0])
X = X * (1 - s) + G * s

# 3. tighter crop around the rug
c = e("CROP", 0.88); cw, ch = int(W * c), int(H * c)
ys, xs = np.nonzero(a); cx = int(np.clip(xs.mean() - cw / 2, 0, W - cw)); cy = int(np.clip(H - ch - (H - ys.max()) * 0.35, 0, H - ch))
img = Image.fromarray(X.clip(0, 255).astype(np.uint8)).crop((cx, cy, cx + cw, cy + ch)).resize((W, H), Image.LANCZOS)
img.save(out_p); print("crop %.0f%% -> rug %.0f%% larger in the frame, saved %s" % (100 * c, 100 * (1 / c - 1), out_p))
