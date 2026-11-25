"""Honest crispness for a soft product photo: Real-ESRGAN x4 on the product area (tiles, fp16), brought back to the original
size (a restoration pass, no new objects), blended with the original (MIX), then local contrast ('clarity': unsharp mask with a
large radius) to bring back the volume of bobbles/pile. Only the product's colours change; its alpha stays.
Env: MIX (ESRGAN share, 0.6), CLARITY (percent, 35), RAD (px, 6).
Usage: enhance_product.py photo.png cutout_full_frame.png out_cutout.png"""
import os, sys
import numpy as np, torch
from pathlib import Path
from PIL import Image, ImageFilter
from spandrel import ModelLoader

photo_p, cut_p, out_p = sys.argv[1:4]
MIX = float(os.environ.get("MIX", 0.6)); CL = int(os.environ.get("CLARITY", 35)); RAD = float(os.environ.get("RAD", 6))
ph = Image.open(photo_p).convert("RGB"); cut = Image.open(cut_p).convert("RGBA").resize(ph.size, Image.LANCZOS)
a = np.asarray(cut.split()[3]); ys, xs = np.nonzero(a > 8)
pad = 16; x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad); x1, y1 = min(ph.width, xs.max() + pad), min(ph.height, ys.max() + pad)
crop = ph.crop((x0, y0, x1, y1)); w, h = crop.size
model = ModelLoader().load_from_file(str(Path.home() / "ComfyUI/models/upscale_models/RealESRGAN_x4plus.pth")).cuda().eval().half()
x = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255).permute(2, 0, 1)[None]
out = torch.zeros(1, 3, h * 4, w * 4); T, P = 256, 16
with torch.inference_mode():
    for ty in range(0, h, T):
        for tx in range(0, w, T):
            ya, xa = max(0, ty - P), max(0, tx - P); yb, xb = min(h, ty + T + P), min(w, tx + T + P)
            tile = model(x[:, :, ya:yb, xa:xb].cuda().half()).float().cpu()
            yh, xw = min(h, ty + T) - ty, min(w, tx + T) - tx
            out[:, :, ty * 4:(ty + yh) * 4, tx * 4:(tx + xw) * 4] = tile[:, :, (ty - ya) * 4:(ty - ya + yh) * 4, (tx - xa) * 4:(tx - xa + xw) * 4]
esr = Image.fromarray((out[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
rest = Image.blend(crop, esr, MIX).filter(ImageFilter.UnsharpMask(radius=RAD, percent=CL, threshold=1))
rgb = np.asarray(cut.convert("RGB")).copy(); rgb[y0:y1, x0:x1] = np.asarray(rest)
Image.fromarray(np.dstack([rgb, a]), "RGBA").save(out_p); print("saved", out_p)
