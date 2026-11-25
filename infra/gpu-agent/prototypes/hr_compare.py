"""Same finishing for every matte (region from SAM minus the neighbours, colours recovered, matte 1 px tighter), on red, one edge crop per variant."""
import sys, json
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from pymatting import estimate_foreground_ml
from rembg import new_session, remove

base = Path.home() / "ComfyUI"; out = base / "output/etap0"; arch = out / "_second_tests"
name = sys.argv[1]; sizes = [int(s) for s in sys.argv[2:]]
RED = np.array((176, 32, 42)) / 255
im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB")
meta = json.load(open(out / f"{name}_hr_box.json")); box = tuple(meta["box"]); k = meta["k"]
W, H = im.size

def up(a):  # thumbnail-resolution mask -> original resolution
    return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float64) / 255

sam = np.asarray(Image.open(arch / f"{name}_sam_mask.png").convert("L")) > 127
region = np.clip(1.0 - ndi.distance_transform_edt(~sam) / 35, 0, 1)
excl_path = arch / f"{name}_sam_excl.png"
if excl_path.exists():
    excl = np.asarray(Image.open(excl_path).convert("L")) > 127
    region = region * (1.0 - np.clip(ndi.gaussian_filter(ndi.binary_dilation(excl, iterations=3).astype(np.float64), 1.5), 0, 1))
region = up(region)

crop = im.crop(box)
variants = []
session = new_session("birefnet-general")
variants.append(("ONNX BiRefNet general (1024 px) - what we had", np.asarray(remove(crop, session=session).split()[3], dtype=np.float64) / 255))
for s in sizes:
    variants.append((f"HR-matting at {s} px", np.asarray(Image.open(out / f"{name}_hr_alpha_{s}.png"), dtype=np.float64) / 255))

rgb_crop = np.asarray(crop, dtype=np.float64) / 255
reg_crop = region[box[1]:box[3], box[0]:box[2]]
ex = (int(330 * k) - box[0], int(400 * k) - box[1], int(830 * k) - box[0], int(600 * k) - box[1])   # the edge that looked torn
ex = (max(0, ex[0]), max(0, ex[1]), min(crop.width, ex[2]), min(crop.height, ex[3]))
tiles = []
for label, a in variants:
    a = a * reg_crop
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float64) / 255
    fg = estimate_foreground_ml(rgb_crop, a)
    comp = (fg * a[..., None] + RED * (1 - a[..., None])) * 255
    tile = Image.fromarray(comp.clip(0, 255).astype(np.uint8)).crop(ex)
    ImageDraw.Draw(tile).text((10, 8), label, fill=(255, 255, 255))
    tiles.append(tile)
    Image.fromarray((np.dstack([fg, a]) * 255).clip(0, 255).astype(np.uint8), "RGBA").save(out / f"{name}_{label.split()[0].lower()}_{len(tiles)}_cutout.png")
sheet = Image.new("RGB", (tiles[0].width, sum(t.height for t in tiles)))
y = 0
for t in tiles:
    sheet.paste(t, (0, y)); y += t.height
sheet.save(out / f"{name}_hr_edges_on_red.jpg", quality=90); print("sheet", sheet.size)
