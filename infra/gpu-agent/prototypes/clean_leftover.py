"""Removes what is left of the MODEL's own product around the original product's contour (a thicker / bigger edge that peeks
out from under the pasted original - the 'sandwich' look), and fills it with floor via LaMa. No AI judgement involved:
a pixel next to the contour is a leftover when its colour does not look like the floor a little farther away
(chromaticity far from the floor's, or much darker than a contact shadow can be).
Usage: clean_leftover.py frame.png cutout_full_frame.png out.png [mask_debug.png]"""
import sys
from pathlib import Path
import numpy as np, torch
from PIL import Image
from scipy import ndimage as ndi

frame_p, cut_p, out_p = sys.argv[1:4]; dbg = sys.argv[4] if len(sys.argv) > 4 else None
F = np.asarray(Image.open(frame_p).convert("RGB")).astype(np.float64) / 255; H, W = F.shape[:2]
a = np.asarray(Image.open(cut_p).convert("RGBA").resize((W, H), Image.LANCZOS).split()[3]) / 255.0
s = W / 1824                                                         # sizes below tuned for a ~1800 px wide frame
prod = a > 0.05
near = ndi.binary_dilation(prod, iterations=int(40 * s)) & ~(a > 0.6)               # where leftovers can be
ref = ndi.binary_dilation(prod, iterations=int(95 * s)) & ~ndi.binary_dilation(prod, iterations=int(55 * s))   # floor
lum = F.mean(axis=2) + 1e-4
chroma = F / lum[..., None]                                           # brightness-free colour
mu = np.median(chroma[ref], axis=0); dev = np.median(np.abs(chroma[ref] - mu), axis=0) + 0.01
cdist = np.abs((chroma - mu) / dev).max(axis=2)
Lfloor = np.median(lum[ref])
left = near & ((cdist > 6) | (lum < 0.4 * Lfloor))
left = ndi.binary_opening(left, iterations=1)
left = ndi.binary_dilation(left, iterations=3) & near
print("leftover pixels: %d (%.2f%% of the frame)" % (left.sum(), left.mean() * 100))
if dbg: Image.fromarray((left * 255).astype(np.uint8)).save(dbg)
if left.sum():
    lama = torch.jit.load(str(Path.home() / "ComfyUI/models/lama/big-lama.pt"), map_location="cuda").eval()
    ys, xs = np.nonzero(left); m = int(64 * s)
    y0, y1, x0, x1 = max(0, ys.min() - m), min(H, ys.max() + m), max(0, xs.min() - m), min(W, xs.max() + m)
    crop, mk = F[y0:y1, x0:x1], left[y0:y1, x0:x1]
    h, w = mk.shape; ph, pw = (-h) % 8, (-w) % 8
    img = np.pad(crop.transpose(2, 0, 1), ((0, 0), (0, ph), (0, pw)), mode="reflect")
    mm = np.pad(mk.astype(np.float32)[None], ((0, 0), (0, ph), (0, pw)), mode="reflect")
    with torch.inference_mode():
        res = lama(torch.from_numpy(img).float()[None].cuda(), (torch.from_numpy(mm)[None].cuda() > 0).float())
    fill = res[0].permute(1, 2, 0).cpu().numpy()[:h, :w].clip(0, 1)
    F[y0:y1, x0:x1][mk] = fill[mk]
Image.fromarray((F * 255).astype(np.uint8)).save(out_p); print("saved", out_p)
