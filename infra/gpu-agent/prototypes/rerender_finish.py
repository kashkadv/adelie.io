"""Finish a rug re-rendered by the model (klein with a noise mask over the rug, the placed composite as image 1): the rug
itself - pile, volume, soft edge - comes from the model; the floor band around it, which the model also repainted at 1 MP
(soft 'soap' after the x2 upscale), comes back from the sharp composite with the model's brightness (its contact shadow
and sun stripes).
Usage: rerender_finish.py composite_B_x2.png rerendered_R_x2.png cutout_canvas.png out.png   env: EDGE 10 (px the model's
fluffy edge reaches beyond the rug outline), BAND 40 (px around the rug taken from B), SIG 6, GMIN 0.4, GMAX 1.3"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

B, R = (np.asarray(Image.open(p).convert("RGB")).astype(float) for p in sys.argv[1:3]); cut_p, out_p = sys.argv[3:5]
H, W = B.shape[:2]
EDGE = int(os.environ.get("EDGE", 10)); BAND = int(os.environ.get("BAND", 40)); SIG = float(os.environ.get("SIG", 6))
GMIN = float(os.environ.get("GMIN", 0.4)); GMAX = float(os.environ.get("GMAX", 1.3))
a = np.asarray(Image.open(cut_p).convert("RGBA").split()[3].resize((W, H))) > 128
rug = ndi.gaussian_filter(ndi.binary_dilation(a, iterations=EDGE).astype(float), 3)[..., None]       # model's rug + its edge
band = ndi.gaussian_filter(ndi.binary_dilation(a, iterations=EDGE + BAND).astype(float), BAND / 4)[..., None]
lum = lambda X: ndi.gaussian_filter(X.mean(2), SIG)
gain = np.clip((lum(R) + 1) / (lum(B) + 1), GMIN, GMAX)[..., None]
floor = np.clip(B * gain, 0, 255)                                      # sharp floor, the model's light and contact shadow
out = R * (1 - band) + floor * band                                    # far away: R (= B up to the model's light)
out = out * (1 - rug) + R * rug                                        # the rug: the model's
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(out_p)
print("rug from the model, %d px floor band from the composite, saved %s" % (BAND, out_p))
