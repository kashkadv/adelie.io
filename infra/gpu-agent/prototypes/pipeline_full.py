"""The whole cutout, at the ORIGINAL resolution, on the GPU:
SAM region (+35 px) minus the neighbours -> BiRefNet HR-matting (1536 px, fp16) on the crop -> drop detached chunks ->
colours of the edge recovered -> matte 1 px tighter -> enclosed holes filled with LaMa."""
import sys, time, json, os
sys.path.insert(0, str(__import__("pathlib").Path.home() / "BiRefNet"))
import numpy as np, torch
from pathlib import Path
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from pymatting import estimate_foreground_ml
from safetensors.torch import load_file
from models.birefnet import BiRefNet

base = Path.home() / "ComfyUI"; out = base / "output/etap0"; arch = out / "_second_tests"
CREAM, RED = np.array((240, 232, 218)) / 255, np.array((176, 32, 42)) / 255
SIZE, REGION_PX = 1536, 35
CORE = int(os.environ.get('CORE', 0))   # px (of the 1500 px copy) the solid SAM core is pulled in from the edge; 0 = no core
TAG = os.environ.get('TAG', '')
SMALL = int(os.environ.get('SMALL', 0))   # fill matte holes smaller than this (px of the 1500 px copy) inside the product
CLOSE = int(os.environ.get('CLOSE', 6)); MAXHOLE = int(os.environ.get('MAXHOLE', 1500))   # closing steps; small-hole area (px of the 1500 px copy)

model = BiRefNet(bb_pretrained=False)
model.load_state_dict(load_file(str(Path.home() / "BiRefNet/weights/hr-matting.safetensors")), strict=True)
model = model.half().cuda().eval()
lama = torch.jit.load(str(base / "models/lama/big-lama.pt"), map_location="cuda").eval()
mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1).cuda().half(); std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1).cuda().half()

def matte(crop):
    x0 = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255).permute(2, 0, 1)[None].cuda().half()
    x = (torch.nn.functional.interpolate(x0, size=(SIZE, SIZE), mode="bilinear", align_corners=False) - mean) / std
    with torch.inference_mode():
        p = model(x)[-1].sigmoid().float()
    return torch.nn.functional.interpolate(p, size=x0.shape[-2:], mode="bilinear", align_corners=False)[0, 0].cpu().numpy().astype(np.float64)

def inpaint(rgb, mask):
    h, w = mask.shape; ph, pw = (-h) % 8, (-w) % 8
    img = np.pad(rgb.transpose(2, 0, 1), ((0, 0), (0, ph), (0, pw)), mode="reflect")
    m = np.pad(mask.astype(np.float32)[None], ((0, 0), (0, ph), (0, pw)), mode="reflect")
    with torch.inference_mode():
        r = lama(torch.from_numpy(img).float()[None].cuda(), (torch.from_numpy(m)[None].cuda() > 0).float())
    return r[0].permute(1, 2, 0).cpu().numpy()[:h, :w].clip(0, 1)

def drop_detached(a, min_area, min_gap):
    solid = a > 0.5
    lab, n = ndi.label(solid)
    if n < 2:
        return a, 0
    sizes = ndi.sum(solid, lab, index=np.arange(1, n + 1)); main = 1 + int(np.argmax(sizes))
    dist = ndi.distance_transform_edt(lab != main); dropped = 0
    for k in range(1, n + 1):
        if k != main and sizes[k - 1] >= min_area and dist[lab == k].min() > min_gap:
            a = np.where(ndi.binary_dilation(lab == k, iterations=int(min_gap / 3)), 0.0, a); dropped += 1
    return a, dropped

for name in sys.argv[1:]:
    t0 = time.time()
    im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB"); W, H = im.size
    th = Image.open(base / f"input/gushka/{name}.jpg"); th.thumbnail((1500, 1500)); k = W / th.width
    sam = np.asarray(Image.open(arch / f"{name}_sam_mask.png").convert("L")) > 127
    region = np.clip(1.0 - ndi.distance_transform_edt(~sam) / REGION_PX, 0, 1)
    ep = arch / f"{name}_sam_excl.png"
    if ep.exists():
        excl = np.asarray(Image.open(ep).convert("L")) > 127
        region *= 1.0 - np.clip(ndi.gaussian_filter(ndi.binary_dilation(excl, iterations=3).astype(np.float64), 1.5), 0, 1)
    region = np.asarray(Image.fromarray((region * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float64) / 255
    ys, xs = np.where(sam); m = 80
    box = (max(0, int((xs.min() - m) * k)), max(0, int((ys.min() - m) * k)), min(W, int((xs.max() + m) * k)), min(H, int((ys.max() + m) * k)))
    t1 = time.time()
    a = np.zeros((H, W)); a[box[1]:box[3], box[0]:box[2]] = matte(im.crop(box)); torch.cuda.synchronize()
    t_matte = time.time() - t1
    a *= region
    if SMALL:
        # knit gaps are small and round: fill them; fur pockets between strands are bigger and stay see-through
        solid_sam = ndi.binary_closing(np.pad(sam, 20), iterations=CLOSE)[20:-20, 20:-20]
        solid_full = np.asarray(Image.fromarray(solid_sam.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 127
        lab_l, n_l = ndi.label((a < 0.5) & solid_full)
        if n_l:
            sz = ndi.sum(np.ones_like(a), lab_l, index=np.arange(1, n_l + 1))
            fillm = np.isin(lab_l, 1 + np.where(sz < SMALL * k * k)[0])
            a = np.maximum(a, np.clip(ndi.gaussian_filter(ndi.binary_dilation(fillm, iterations=2).astype(np.float64), 1.2), 0, 1))
    if CORE:
        # inside the product nothing is see-through (knit gaps, fur pockets): the solid SAM mask is the floor there;
        # only the outer CORE px of the edge are left to the matting model (the fine hairs)
        # SAM leaves out the see-through-looking gaps of a knit: close them, and fill small enclosed holes
        # (big ones, like the hand of the model, are kept as they are)
        solid_sam = ndi.binary_closing(np.pad(sam, 20), iterations=CLOSE)[20:-20, 20:-20]
        holes = ndi.binary_fill_holes(solid_sam) & ~solid_sam
        lab_h, n_h = ndi.label(holes)
        if n_h:
            small = 1 + np.where(ndi.sum(holes, lab_h, index=np.arange(1, n_h + 1)) < MAXHOLE)[0]
            solid_sam |= np.isin(lab_h, small)
        core = (ndi.distance_transform_edt(solid_sam) > CORE).astype(np.float64)
        core = np.asarray(Image.fromarray((ndi.gaussian_filter(core, 1.5) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float64) / 255
        a = np.maximum(a, core)
    a, dropped = drop_detached(a, min_area=int(120 * k * k), min_gap=int(12 * k))
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float64) / 255
    rgb = np.asarray(im, dtype=np.float64) / 255
    fg = rgb.copy()
    fg[box[1]:box[3], box[0]:box[2]] = estimate_foreground_ml(rgb[box[1]:box[3], box[0]:box[2]], a[box[1]:box[3], box[0]:box[2]])
    solid = a > 0.5
    hole = ndi.binary_fill_holes(solid) & ~solid
    lab, n = ndi.label(hole)
    big = np.isin(lab, 1 + np.where(ndi.sum(hole, lab, index=np.arange(1, n + 1)) >= 400 * k * k)[0]) if n else hole & False
    filled = int(big.sum())
    if filled:
        mk = ndi.binary_dilation(big, iterations=int(8 * k)); yy, xx = np.where(mk); pad = int(160 * k)
        y0, y1, x0, x1 = max(0, yy.min() - pad), min(H, yy.max() + pad), max(0, xx.min() - pad), min(W, xx.max() + pad)
        res = inpaint(rgb[y0:y1, x0:x1], mk[y0:y1, x0:x1]); soft = np.clip(ndi.gaussian_filter(mk.astype(np.float64), 1.5 * k), 0, 1)
        patch = np.zeros_like(fg); patch[y0:y1, x0:x1] = res
        fg = np.where(mk[..., None], patch * soft[..., None] + fg * (1 - soft[..., None]), fg); a = np.maximum(a, soft * mk)
    def on(bg):
        return Image.fromarray(((fg * a[..., None] + bg * (1 - a[..., None])) * 255).clip(0, 255).astype(np.uint8))
    Image.fromarray((np.dstack([fg, a]) * 255).clip(0, 255).astype(np.uint8), "RGBA").save(out / f"{name}{TAG}_cutout.png")
    c, r = on(CREAM), on(RED)
    c.save(out / f"{name}{TAG}_on_cream.jpg", quality=93); r.save(out / f"{name}{TAG}_on_red.jpg", quality=93)
    sheet = Image.new("RGB", (W * 3, H)); [sheet.paste(x, (i * W, 0)) for i, x in enumerate((im, c, r))]
    sheet.thumbnail((2400, 2400)); sheet.save(out / f"{name}{TAG}_full.jpg", quality=90)
    print(f"{name}: {W}x{H}, matte {t_matte:.2f}s on the GPU, total {time.time() - t0:.1f}s, detached chunks dropped {dropped}, hole pixels filled {filled}", flush=True)
