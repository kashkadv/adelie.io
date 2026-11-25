"""x2 upscale as agreed: Real-ESRGAN x4, brought down to x2, blended 50/50 with a plain bicubic x2 (keeps some of the wool's fuzz)."""
import sys, time
import numpy as np, torch
from pathlib import Path
from PIL import Image
from spandrel import ModelLoader

base = Path.home() / "ComfyUI"
name = sys.argv[1]
im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB")
model = ModelLoader().load_from_file(str(base / "models/upscale_models/RealESRGAN_x4plus.pth")).cuda().eval()
t = time.time()
x = torch.from_numpy(np.asarray(im, dtype=np.float32) / 255).permute(2, 0, 1)[None].cuda()
with torch.inference_mode():
    y = model(x)[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy()
esr = Image.fromarray((y * 255).astype(np.uint8))
size = (im.width * 2, im.height * 2)
plain = im.resize(size, Image.BICUBIC)
blend = Image.blend(plain, esr.resize(size, Image.LANCZOS), 0.5)
blend.save(base / f"input/gushka/{name}x2.jpg", quality=95)
plain.save(base / f"output/etap0/{name}_x2_plain.jpg", quality=95)
esr.resize(size, Image.LANCZOS).save(base / f"output/etap0/{name}_x2_esrgan_only.jpg", quality=95)
print(f"{name}: {im.size} -> {blend.size}, ESRGAN x4 took {time.time() - t:.1f}s on the GPU")
