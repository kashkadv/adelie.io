"""Last step: drop detached chunks and fill enclosed holes (a hand, a bag strap) with LaMa."""
import sys
import numpy as np, torch
from pathlib import Path
from PIL import Image
from scipy import ndimage as ndi

base = Path.home() / "ComfyUI"; out = base / "output/etap0"
CREAM = np.array((240, 232, 218)) / 255
lama = torch.jit.load(str(base / "models/lama/big-lama.pt"), map_location="cuda").eval()

def inpaint(rgb, mask):
    """rgb float [0,1] HxWx3, mask bool HxW -> LaMa result (same size)."""
    h, w = mask.shape
    ph, pw = (-h) % 8, (-w) % 8
    img = np.pad(rgb.transpose(2, 0, 1), ((0, 0), (0, ph), (0, pw)), mode="reflect")
    m = np.pad(mask.astype(np.float32)[None], ((0, 0), (0, ph), (0, pw)), mode="reflect")
    with torch.inference_mode():
        res = lama(torch.from_numpy(img).float()[None].cuda(), (torch.from_numpy(m)[None].cuda() > 0).float())
    return res[0].permute(1, 2, 0).cpu().numpy()[:h, :w].clip(0, 1)

def clean(a, min_area=120, min_gap=12):
    solid = a > 0.5
    lab, n = ndi.label(solid)
    if n < 2:
        return a, 0
    sizes = ndi.sum(solid, lab, index=np.arange(1, n + 1))
    main = 1 + int(np.argmax(sizes))
    dist_main = ndi.distance_transform_edt(lab != main)
    dropped = 0
    for k in range(1, n + 1):
        if k == main or sizes[k - 1] < min_area:
            continue
        comp = lab == k
        if dist_main[comp].min() > min_gap:
            a = np.where(ndi.binary_dilation(comp, iterations=4), 0.0, a); dropped += 1
    return a, dropped

for name in sys.argv[1:]:
    rgba = np.asarray(Image.open(out / f"{name}_cutout.png").convert("RGBA"), dtype=np.float64) / 255
    fg, a = rgba[..., :3].copy(), rgba[..., 3].copy()
    a, dropped = clean(a)
    solid = a > 0.5
    hole = ndi.binary_fill_holes(solid) & ~solid
    lab, n = ndi.label(hole)
    big = np.isin(lab, 1 + np.where(ndi.sum(hole, lab, index=np.arange(1, n + 1)) >= 400)[0]) if n else hole & False
    filled = 0
    if big.any():
        photo = np.asarray(Image.open(base / f"input/gushka/{name}.jpg").convert("RGB").copy().resize(a.shape[::-1]), dtype=np.float64) / 255
        m = ndi.binary_dilation(big, iterations=8)
        ys, xs = np.where(m); pad = 160
        y0, y1, x0, x1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad), max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
        res = inpaint(photo[y0:y1, x0:x1], m[y0:y1, x0:x1])
        soft = np.clip(ndi.gaussian_filter(m.astype(np.float64), 1.5), 0, 1)[..., None]
        patch = np.zeros_like(fg); patch[y0:y1, x0:x1] = res
        fg = np.where(m[..., None], patch * soft + fg * (1 - soft), fg)
        a = np.maximum(a, soft[..., 0] * m)
        filled = int(big.sum())
    comp = fg * a[..., None] + CREAM * (1 - a[..., None])
    Image.fromarray((np.dstack([fg, a]) * 255).clip(0, 255).astype(np.uint8), "RGBA").save(out / f"{name}_final.png")
    Image.fromarray((comp * 255).clip(0, 255).astype(np.uint8)).save(out / f"{name}_final_on_cream.jpg", quality=93)
    print(f"{name}: detached chunks dropped {dropped}, hole pixels filled {filled}")
