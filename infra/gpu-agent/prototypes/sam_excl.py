"""What is NOT the product but sits next to it (bag, hand, face, hair, chair): masks to subtract from the grown region."""
import sys
import numpy as np, torch
from pathlib import Path
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, Sam2Model, Sam2Processor

base = Path.home() / "ComfyUI"; out = base / "output/etap0"; dev = "cuda"
dino_p = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
dino = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny").to(dev).eval()
sam_p = Sam2Processor.from_pretrained("facebook/sam2.1-hiera-small")
sam = Sam2Model.from_pretrained("facebook/sam2.1-hiera-small").to(dev).eval()

for spec in sys.argv[1:]:
    name, prompt = spec.split("=", 1)
    im = Image.open(base / f"input/gushka/{name}.jpg").convert("RGB"); im.thumbnail((1500, 1500))
    prod = np.asarray(Image.open(out / f"{name}_sam_mask.png").convert("L")) > 127
    with torch.no_grad():
        inp = dino_p(images=im, text=prompt, return_tensors="pt").to(dev)
        res = dino_p.post_process_grounded_object_detection(dino(**inp), inp.input_ids, threshold=0.3, text_threshold=0.25,
                                                           target_sizes=[im.size[::-1]])[0]
    excl = np.zeros(prod.shape, bool)
    for box, score, label in zip(res["boxes"].cpu().tolist(), res["scores"].cpu().tolist(), res["text_labels"]):
        with torch.no_grad():
            sin = sam_p(images=im, input_boxes=[[box]], return_tensors="pt").to(dev)
            so = sam(**sin, multimask_output=True)
            masks = sam_p.post_process_masks(so.pred_masks.cpu(), sin["original_sizes"].cpu())[0]
        cands = masks.reshape(-1, *masks.shape[-2:]).numpy().astype(bool)
        # the whole object (the biggest candidate), as long as it is not mostly the product itself
        fits = [k for k in range(len(cands)) if (cands[k] & prod).sum() / max(1, cands[k].sum()) <= 0.6]
        c = cands[max(fits, key=lambda k: cands[k].sum())] if fits else cands[0]
        share = (c & prod).sum() / max(1, c.sum())
        print(f"  {name} {label!r} score {score:.2f} box {[round(v) for v in box]} -> mask {100*c.mean():.1f}% of the frame, "
              f"{100*share:.0f}% of it is the product" + (" -> skipped" if share > 0.6 else ""))
        if share <= 0.6:
            excl |= c
    excl &= ~prod  # where they overlap, the product wins
    Image.fromarray(excl.astype(np.uint8) * 255).save(out / f"{name}_sam_excl.png")
