"""Sharp pixels back, light from the relit frame. The relit pass (klein at 1 MP, upscaled x2) is soft; around the product
(its fibre edge and the repainted floor band) that reads as 'soap'. Where the composite B differs from the empty room A
(product + repainted floor), take B's sharp pixels and give them the relit frame's brightness:
  out = B * clip(blur(lum R) / blur(lum B), GMIN, GMAX)    near the product,   R elsewhere.
Usage: relight_back.py room_A_x2.png composite_B.png relit_R_x2.png out.png   env: SIG 6, GMIN 0.3, GMAX 1.4, GROW 30"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

A, B, R = (np.asarray(Image.open(p).convert("RGB")).astype(float) for p in sys.argv[1:4]); out_p = sys.argv[4]
SIG = float(os.environ.get("SIG", 6)); GMIN = float(os.environ.get("GMIN", 0.3)); GMAX = float(os.environ.get("GMAX", 1.4))
GROW = int(os.environ.get("GROW", 30))
diff = ndi.gaussian_filter(np.abs(B - A).mean(2), 2) > 10               # product + repainted floor band
diff = ndi.binary_opening(diff, iterations=3)
lab, n = ndi.label(diff); big = np.bincount(lab.ravel()); big[0] = 0
zone = lab == big.argmax()                                            # the product's blob only
zone = ndi.binary_fill_holes(ndi.binary_dilation(zone, iterations=GROW))
w = ndi.gaussian_filter(zone.astype(float), GROW / 3)[..., None]
lum = lambda X: ndi.gaussian_filter(X.mean(2), SIG)
gain = np.clip((lum(R) + 1) / (lum(B) + 1), GMIN, GMAX)[..., None]
out = R * (1 - w) + np.clip(B * gain, 0, 255) * w
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(out_p)
print("zone %.1f%% of the frame, gain %.2f..%.2f, saved %s" % (100 * zone.mean(), gain[zone].min(), gain[zone].max(), out_p))
