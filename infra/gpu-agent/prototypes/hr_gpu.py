"""BiRefNet_HR-matting on the GPU in fp16: time, peak VRAM and how far the result is from the fp32 CPU one."""
import sys, time, json
sys.path.insert(0, str(__import__("pathlib").Path.home() / "BiRefNet"))
import numpy as np, torch
from pathlib import Path
from PIL import Image
from safetensors.torch import load_file
from models.birefnet import BiRefNet

base = Path.home() / "ComfyUI"; out = base / "output/etap0"
name = sys.argv[1]; sizes = [int(s) for s in sys.argv[2:]]
im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB")
box = tuple(json.load(open(out / f"{name}_hr_box.json"))["box"])
crop = im.crop(box)
model = BiRefNet(bb_pretrained=False)
model.load_state_dict(load_file(str(Path.home() / "BiRefNet/weights/hr-matting.safetensors")), strict=True)
model = model.half().cuda().eval()
mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1).cuda().half(); std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1).cuda().half()
x0 = torch.from_numpy(np.asarray(crop, dtype=np.float32) / 255).permute(2, 0, 1)[None].cuda().half()
print("VRAM with the model loaded: %.2f GB" % (torch.cuda.memory_allocated() / 2**30), flush=True)
for s in sizes:
    try:
        torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats()
        for run in ("warm-up", "timed"):
            torch.cuda.synchronize(); t = time.time()
            x = (torch.nn.functional.interpolate(x0, size=(s, s), mode="bilinear", align_corners=False) - mean) / std
            with torch.inference_mode():
                pred = model(x)[-1].sigmoid().float()
            a = torch.nn.functional.interpolate(pred, size=x0.shape[-2:], mode="bilinear", align_corners=False)[0, 0].cpu().numpy()
            torch.cuda.synchronize(); dt = time.time() - t
        peak = torch.cuda.max_memory_allocated() / 2**30
        Image.fromarray((a * 255).clip(0, 255).astype(np.uint8)).save(out / f"{name}_hr_alpha_{s}_gpu.png")
        ref = out / f"{name}_hr_alpha_{s}.png"
        diff = (np.abs(a - np.asarray(Image.open(ref), dtype=np.float32) / 255).mean() if ref.exists() else float("nan"))
        print(f"size {s}: {dt:.2f}s ({'second run' if run == 'timed' else ''}), peak VRAM {peak:.2f} GB, mean |fp16 gpu - fp32 cpu| = {diff:.4f}", flush=True)
    except torch.cuda.OutOfMemoryError:
        print(f"size {s}: out of memory on the GPU", flush=True); torch.cuda.empty_cache()
