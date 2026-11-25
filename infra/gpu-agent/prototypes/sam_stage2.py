"""Stage 2: the SAM mask only says WHERE the product is (grown by R px); BiRefNet on the crop finds the fine strands inside that region."""
import sys, time
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi
from pymatting import estimate_foreground_ml
from rembg import new_session, remove

base = Path.home() / "ComfyUI"; out = base / "output/etap0"
session = new_session("birefnet-general")
CREAM, RED = (240, 232, 218), (176, 32, 42)
R = int(sys.argv[1])

def process(name):
    t0 = time.time()
    im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB"); im.thumbnail((1500, 1500))
    sam = np.asarray(Image.open(out / f"{name}_sam_mask.png").convert("L")) > 127
    # where the product may be: the SAM mask grown by R px, softly (1 inside, fading to 0 at R px outside)
    dist = ndi.distance_transform_edt(~sam)
    region = np.clip(1.0 - dist / R, 0, 1)
    # what is next to the product but is not it (bag, hand, face, hair, chair): cut out of the region, with a small margin
    ep = out / f"{name}_sam_excl.png"
    if ep.exists():
        excl = np.asarray(Image.open(ep).convert("L")) > 127
        region = region * (1.0 - np.clip(ndi.gaussian_filter(ndi.binary_dilation(excl, iterations=3).astype(np.float64), 1.5), 0, 1))
    ys, xs = np.where(region > 0)
    m = 20
    box = (max(0, xs.min() - m), max(0, ys.min() - m), min(im.width, xs.max() + m), min(im.height, ys.max() + m))
    alpha_b = np.zeros(sam.shape, dtype=np.float64)
    alpha_b[box[1]:box[3], box[0]:box[2]] = np.asarray(remove(im.crop(box), session=session).split()[3], dtype=np.float64) / 255
    alpha = alpha_b * region
    sam_only = ndi.gaussian_filter(sam.astype(np.float64), 1.0)
    def finish(a):
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float64) / 255
        return estimate_foreground_ml(np.asarray(im, dtype=np.float64) / 255, a), a
    fg, a = finish(alpha); fg0, a0 = finish(sam_only)
    def on(fg, a, bg):
        return Image.fromarray(((fg * a[..., None] + (np.array(bg) / 255) * (1 - a[..., None])) * 255).clip(0, 255).astype(np.uint8))
    Image.fromarray((np.dstack([fg, a]) * 255).clip(0, 255).astype(np.uint8), "RGBA").save(out / f"{name}_cutout.png")
    sheet = Image.new("RGB", (im.width * 3, im.height))
    for i, x in enumerate((im, on(fg, a, CREAM), on(fg, a, RED))):
        sheet.paste(x, (i * im.width, 0))
    sheet.thumbnail((2400, 2400)); sheet.save(out / f"{name}_full.jpg", quality=90)
    on(fg, a, CREAM).save(out / f"{name}_on_cream.jpg", quality=93); on(fg, a, RED).save(out / f"{name}_on_red.jpg", quality=93)
    # the difference that matters: SAM mask as the matte vs SAM as a region for BiRefNet, on one crop of the edge
    cmp_ = Image.new("RGB", (2 * 520, 640))
    ys2, xs2 = np.where(sam)
    cx, cy = int(xs2.min()), int((ys2.min() + ys2.max()) / 2) - 320
    cb = (max(0, cx - 60), max(0, cy), max(0, cx - 60) + 520, max(0, cy) + 640)
    for i, (f_, a_) in enumerate(((fg0, a0), (fg, a))):
        cmp_.paste(on(f_, a_, CREAM).crop(cb), (i * 520, 0))
    cmp_.save(out / f"{name}_sam_vs_region.jpg", quality=90)
    print(name, "box", tuple(int(v) for v in box), "%.1fs" % (time.time() - t0))

for n in sys.argv[2:]:
    process(n)
