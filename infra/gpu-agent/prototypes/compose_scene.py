"""Puts a cutout (RGBA) onto a generated scene: scale, place on the floor, a contact shadow under it. Optionally pastes the ORIGINAL
product pixels back over a harmonised image, so the product itself is never generated or altered."""
import sys, json
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

base = Path.home() / "ComfyUI"; out = base / "output/etap0"

def load_cutout(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im.split()[3])
    ys, xs = np.where(a > 8)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def place(scene, cut, width_share, cx, floor_y):
    """scale the cutout to `width_share` of the scene width, its bottom edge at floor_y (fraction), centred at cx (fraction)."""
    W, H = scene.size
    w = int(W * width_share); h = int(cut.height * w / cut.width)
    c = cut.resize((w, h), Image.LANCZOS)
    x = int(W * cx - w / 2); y = int(H * floor_y - h)
    return c, (x, y)

def shadow(scene_size, c, pos, strength=1.0):
    """A soft shadow on the floor: the product's silhouette squashed and blurred under its bottom edge + a tight dark line at the contact."""
    W, H = scene_size; x, y = pos
    a = np.asarray(c.split()[3], dtype=np.float64) / 255
    h, w = a.shape
    sh_h = max(6, int(h * 0.38))
    squashed = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((w, sh_h), Image.BILINEAR), dtype=np.float64) / 255
    layer = np.zeros((H, W)); contact = np.zeros((H, W))
    y0 = y + h - int(sh_h * 0.55)
    ys, xe = slice(max(0, y0), min(H, y0 + sh_h)), slice(max(0, x), min(W, x + w))
    sq = squashed[: ys.stop - ys.start, : xe.stop - xe.start]
    layer[ys, xe] = sq
    bottom = np.zeros_like(a); bottom[-max(2, h // 40):, :] = a[-max(2, h // 40):, :]
    cy0 = y + h - max(2, h // 40)
    contact[max(0, cy0): min(H, cy0 + bottom.shape[0]), xe] = bottom[: min(H, cy0 + bottom.shape[0]) - max(0, cy0), : xe.stop - xe.start]
    soft = ndi.gaussian_filter(layer, w * 0.02); tight = ndi.gaussian_filter(contact, 2.5)
    return np.clip(soft * strength * 1.2 + tight * 0.7, 0, 0.9)

def composite(scene, c, pos, sh):
    arr = np.asarray(scene.convert("RGB"), dtype=np.float64)
    arr = arr * (1 - sh[..., None] * 0.85)                     # the shadow darkens the floor (multiply)
    out_im = Image.fromarray(arr.clip(0, 255).astype(np.uint8)).convert("RGBA")
    out_im.alpha_composite(c, pos)
    return out_im.convert("RGB")

if __name__ == "__main__":
    scene_path, cut_path, tag = sys.argv[1], sys.argv[2], sys.argv[3]
    share, cx, fy = float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
    scene = Image.open(scene_path).convert("RGB")
    cut = load_cutout(cut_path)
    c, pos = place(scene, cut, share, cx, fy)
    sh = shadow(scene.size, c, pos)
    comp = composite(scene, c, pos, sh)
    comp.save(out / f"{tag}_composite.png")
    json.dump({"pos": pos, "size": c.size}, open(out / f"{tag}_placement.json", "w"))
    c.save(out / f"{tag}_cutout_scaled.png")
    print("composite", comp.size, "cutout at", pos, "size", c.size)
