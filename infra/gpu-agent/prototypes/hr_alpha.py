"""BiRefNet_HR-matting (official code, pinned commit) on the ORIGINAL-resolution crop around the product, at several model sizes."""
import sys, time, resource, json
sys.path.insert(0, str(__import__("pathlib").Path.home() / "BiRefNet"))
import numpy as np, torch
from pathlib import Path
from PIL import Image
from safetensors.torch import load_file
from models.birefnet import BiRefNet

base = Path.home() / "ComfyUI"; out = base / "output/etap0"; arch = out / "_second_tests"
name = sys.argv[1]; sizes = [int(s) for s in sys.argv[2:]]
im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB")          # the original, not the 1500 px copy
scale = im.width / min(im.width, 1000 if im.width <= im.height else 1500)   # the earlier work used a thumbnail of <= 1500 px
th = Image.open(base / f"input/gushka/{name}.jpg"); th.thumbnail((1500, 1500))
k = im.width / th.width
sam = np.asarray(Image.open(arch / f"{name}_sam_mask.png").convert("L")) > 127
ys, xs = np.where(sam)
m = 80
box = (max(0, int((xs.min() - m) * k)), max(0, int((ys.min() - m) * k)), min(im.width, int((xs.max() + m) * k)), min(im.height, int((ys.max() + m) * k)))
crop = im.crop(box); print("original", im.size, "crop box", box, "crop", crop.size, flush=True)
json.dump({"box": box, "k": k}, open(out / f"{name}_hr_box.json", "w"))

model = BiRefNet(bb_pretrained=False)
model.load_state_dict(load_file(str(Path.home() / "BiRefNet/weights/hr-matting.safetensors")), strict=True)
model.eval()
mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1); std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
x0 = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255).permute(2, 0, 1)[None]
for s in sizes:
    t = time.time()
    x = torch.nn.functional.interpolate(x0, size=(s, s), mode="bilinear", align_corners=False)
    x = (x - mean) / std
    with torch.inference_mode(), torch.autocast("cpu", dtype=torch.bfloat16, enabled=s >= 2048):
        pred = model(x)[-1].sigmoid().float()
    a = torch.nn.functional.interpolate(pred, size=x0.shape[-2:], mode="bilinear", align_corners=False)[0, 0].numpy()
    Image.fromarray((a * 255).clip(0, 255).astype(np.uint8)).save(out / f"{name}_hr_alpha_{s}.png")
    print(f"size {s}: {time.time() - t:.0f}s, peak memory {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6:.1f} GB", flush=True)
