"""x2 upscale of a generated (product-free) scene: Real-ESRGAN x4 in tiles on the GPU, brought down to x2. Usage: scene_up2x.py in.png out.png"""
import sys, time
import numpy as np, torch
from pathlib import Path
from PIL import Image
from spandrel import ModelLoader

src, dst = sys.argv[1:3]
im = Image.open(src).convert("RGB"); W, H = im.size
model = ModelLoader().load_from_file(str(Path.home() / "ComfyUI/models/upscale_models/RealESRGAN_x4plus.pth")).cuda().eval().half()
x = torch.from_numpy(np.asarray(im, dtype=np.float32) / 255).permute(2, 0, 1)[None]
T, P = 256, 16                                           # tile and overlap (px of the source)
out = torch.zeros(1, 3, H * 4, W * 4); wsum = torch.zeros(1, 1, H * 4, W * 4)
t0 = time.time()
with torch.inference_mode():
    for y0 in range(0, H, T):
        for x0 in range(0, W, T):
            ya, xa = max(0, y0 - P), max(0, x0 - P); yb, xb = min(H, y0 + T + P), min(W, x0 + T + P)
            tile = model(x[:, :, ya:yb, xa:xb].cuda().half()).float().cpu()
            ys, xs = y0 - ya, x0 - xa; yh, xw = min(H, y0 + T) - y0, min(W, x0 + T) - x0
            out[:, :, y0 * 4:(y0 + yh) * 4, x0 * 4:(x0 + xw) * 4] = tile[:, :, ys * 4:(ys + yh) * 4, xs * 4:(xs + xw) * 4]
img = Image.fromarray((out[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255).astype(np.uint8))
img.resize((W * 2, H * 2), Image.LANCZOS).save(dst)
print("saved", dst, (W * 2, H * 2), "%.1fs" % (time.time() - t0))
