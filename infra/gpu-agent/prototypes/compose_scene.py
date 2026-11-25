"""v2. Puts a cutout (RGBA) onto a generated scene: scale, place on the floor, a contact shadow under it. Optionally pastes the ORIGINAL
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

def perspective(c, inset):
    """Trapezoid: the far (top) edge is narrower by `inset` (fraction of width) on each side, as the floor recedes to the vanishing point."""
    w, h = c.size; d = w * inset
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(d, 0), (w - d, 0), (w, h), (0, h)]
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    coef = np.linalg.solve(np.array(A, dtype=np.float64), np.array([s for p in src for s in p], dtype=np.float64))
    return c.transform((w, h), Image.PERSPECTIVE, tuple(coef), Image.BICUBIC)

def shadow_flat(scene_size, c, pos, light_dx=0.03, ao=0.9, cast=0.35):
    """Shadow of a FLAT object lying on the floor, light from the left window: (1) contact occlusion offset down-right, so it shows
    mostly along the bottom and right edges and hardly at all on top/left; (2) a soft cast shadow sideways (right), never forward.
    Computed on the full scene canvas so the blur is not clipped."""
    W, H = scene_size; x, y = pos
    a = np.asarray(c.split()[3], dtype=np.float64) / 255
    h, w = a.shape
    full = np.zeros((H, W)); full[y:y + h, x:x + w] = a
    ao_l = ndi.shift(ndi.gaussian_filter(full, 2.6), (5, 4), order=1)
    ao_l = np.maximum(ao_l, ndi.shift(ndi.gaussian_filter(full, 7), (7, 6), order=1) * 0.5)
    cast_l = ndi.shift(ndi.gaussian_filter(full, w * 0.018), (-int(h * 0.03), int(w * light_dx)), order=1)
    return np.clip(ao_l * ao + cast_l * cast, 0, 0.92)

def relight(c, ramp=0.05, black=6, desat=0.05, sharpen=60):
    """Gentle tone match to the airy scene: light falls off left->right (window on the left), blacks lifted a little, colour
    slightly less saturated, finally a mild unsharp mask to keep the pile crisp after the downscale. Kept small: the product colour must stay true."""
    rgb = np.asarray(c.convert("RGB"), dtype=np.float64); a = c.split()[3]
    w = rgb.shape[1]
    rgb = rgb * (1 + ramp - 2 * ramp * np.linspace(0, 1, w))[None, :, None]
    g = rgb.mean(axis=2, keepdims=True); rgb = g + (rgb - g) * (1 - desat)
    rgb = black + rgb * (255 - black) / 255
    im = Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=sharpen, threshold=2))
    im.putalpha(a); return im

def bounce(scene_arr, c, pos, strength=0.10, sigma=16):
    """Faint warm colour bounce: the product's mean colour tints the floor right around it."""
    W, H = scene_arr.shape[1], scene_arr.shape[0]; x, y = pos
    a = np.asarray(c.split()[3], dtype=np.float64) / 255; rgb = np.asarray(c.convert("RGB"), dtype=np.float64)
    mean = (rgb * a[..., None]).sum((0, 1)) / max(a.sum(), 1)
    full = np.zeros((H, W)); full[y:y + a.shape[0], x:x + a.shape[1]] = a
    glow = ndi.gaussian_filter(full, sigma) * strength
    return scene_arr * (1 - glow[..., None]) + mean[None, None, :] * glow[..., None]

def product_layer(scene_size, c, pos, wall=3):
    """RGBA layer of the product on the full canvas, with a thin darkened 'pile wall' under the front edge (thickness)."""
    W, H = scene_size; x, y = pos
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = np.asarray(c.split()[3]); rgb = np.asarray(c.convert("RGB"), dtype=np.float64) * 0.5
    wall_im = Image.fromarray(rgb.astype(np.uint8)).convert("RGBA"); wall_im.putalpha(Image.fromarray(a))
    for d in range(1, wall + 1):
        L.alpha_composite(wall_im, (x + (1 if d > 1 else 0), y + d))
    L.alpha_composite(c, (x, y))
    return L

if __name__ == "__main__":
    import os
    scene_path, cut_path, tag = sys.argv[1], sys.argv[2], sys.argv[3]
    share, cx, fy = float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
    scene = Image.open(scene_path).convert("RGB")
    cut = load_cutout(cut_path)
    cut = perspective(cut, float(os.environ.get("PERSP", "0")))      # warp at the native resolution, then ONE downscale
    c, pos = place(scene, cut, share, cx, fy)
    if os.environ.get("RELIGHT", "1") == "1":
        c = relight(c)
    arr = np.asarray(scene, dtype=np.float64)
    arr = bounce(arr, c, pos)
    sh = shadow_flat(scene.size, c, pos, light_dx=float(os.environ.get("SHDX", "0.03")))
    arr = arr * (1 - sh[..., None] * 0.85)
    base = Image.fromarray(arr.clip(0, 255).astype(np.uint8)).convert("RGBA")
    layer = product_layer(scene.size, c, pos)
    base.alpha_composite(layer); comp = base.convert("RGB")
    comp.save(out / f"{tag}_composite.png")
    # the product layer is full-canvas, so paste_back uses pos (0, 0)
    json.dump({"pos": [0, 0], "size": list(scene.size)}, open(out / f"{tag}_placement.json", "w"))
    layer.save(out / f"{tag}_cutout_scaled.png")
    a = np.asarray(layer.split()[3]) > 8
    ring = ndi.binary_dilation(a, iterations=70); ring[: max(0, pos[1] - 30)] = False
    Image.fromarray((ndi.gaussian_filter(ring.astype(float), 18) * 255).astype(np.uint8)).save(out / f"{tag}_floor_mask.png")
    print("composite", comp.size, "product at", pos, "size", c.size)
