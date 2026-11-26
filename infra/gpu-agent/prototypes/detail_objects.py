"""Detail pass for a generated room (owner, 2026-11-26: small objects like a record player come out wrong): GroundingDINO finds
small objects from a known list, each one is cropped with context, enlarged to the model's full resolution and re-rendered
under a noise mask with a specific description, then blended back - the rest of the room is untouched.
Usage: detail_objects.py room.png out.png [object ...]   (default: every object in OBJECTS)
env: START 4 (of 16 steps, how much of the crop is redrawn), PAD 0.6 (context around the box), SEED 7"""
import json, os, subprocess, sys
from pathlib import Path
import numpy as np, torch
from PIL import Image, ImageFilter
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

HERE = Path(__file__).resolve().parent; CUI = Path.home() / "ComfyUI"; PY = str(CUI / "venv/bin/python")
# what each small object must look like (said positively: the model runs without a negative prompt)
OBJECTS = {
    "record player": "a real vinyl record turntable: a rectangular wooden plinth, a black vinyl record on a round platter, "
                     "a slim metal tonearm resting at the side of the record, a clear dust cover hinged open at the back",
    "table lamp": "a real table lamp: a ceramic base, a fabric shade, a straight stem, softly glowing",
    "vase": "a real ceramic vase with a smooth glaze and a clean round opening",
    "picture frame": "a real thin oak picture frame with a white mat and a photograph, straight edges and square corners",
    "potted plant": "a real potted plant with natural leaves and stems in a ceramic pot",
    "books": "real hardcover and paperback books standing upright, straight spines, readable as books",
    "mug": "a real ceramic coffee mug with a handle",
}

room_p, out_p = sys.argv[1:3]; want = sys.argv[3:] or list(OBJECTS)
START = int(os.environ.get("START", 4)); PAD = float(os.environ.get("PAD", 0.6)); SEED = int(os.environ.get("SEED", 7))
room = Image.open(room_p).convert("RGB"); W, H = room.size
P = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
M = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny").to("cuda").eval()
boxes = []
for name in want:
    with torch.no_grad():
        inp = P(images=room, text=name + ".", return_tensors="pt").to("cuda")
        r = P.post_process_grounded_object_detection(M(**inp), inp.input_ids, threshold=0.35, text_threshold=0.3,
                                                     target_sizes=[room.size[::-1]])[0]
    for s, b in zip(r["scores"], r["boxes"]):
        b = [float(v) for v in b]
        if (b[2] - b[0]) * (b[3] - b[1]) < 0.08 * W * H:                  # small objects only
            boxes.append((name, float(s), b))
del M; torch.cuda.empty_cache()
print("found:", [(n, round(s, 2), [round(v) for v in b]) for n, s, b in boxes])

out = room.copy(); inp_dir = CUI / "input"; tmp = CUI / "work" / "_detail"; tmp.mkdir(parents=True, exist_ok=True)
for k, (name, s, (x0, y0, x1, y1)) in enumerate(boxes):
    bw, bh = x1 - x0, y1 - y0; side = max(bw, bh) * (1 + 2 * PAD)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    cx0, cy0 = int(max(0, cx - side / 2)), int(max(0, cy - side / 2)); cx1, cy1 = int(min(W, cx0 + side)), int(min(H, cy0 + side))
    crop = out.crop((cx0, cy0, cx1, cy1)); cw, ch = crop.size
    S = 1024; big = crop.resize((S, int(round(S * ch / cw / 16)) * 16), Image.LANCZOS); bs = big.size
    m = Image.new("L", crop.size, 0); m.paste(255, (int(x0 - cx0 - 0.08 * bw), int(y0 - cy0 - 0.08 * bh),
                                                    int(x1 - cx0 + 0.08 * bw), int(y1 - cy0 + 0.08 * bh)))
    big.save(inp_dir / f"_det_{k}.png"); m.resize(bs).convert("RGB").save(inp_dir / f"_det_{k}_m.png")
    prompt = (f"A close-up crop of a real interior photograph. Redraw only the {name} as {OBJECTS.get(name, 'a real ' + name)}, "
              "keeping its size, position, colours and the light of the room exactly; everything around it stays the same. "
              "Sharp, photographic, true-to-life detail.")
    (tmp / f"p{k}.txt").write_text(prompt)
    env = dict(os.environ, START=str(START), STEPS="16", MASK=f"_det_{k}_m.png", NO_MAIN_REF="1")
    subprocess.run([PY, "-I", str(HERE / "wf_flux3.py"), str(tmp / f"w{k}.json"), str(SEED + k), str(tmp / f"p{k}.txt"),
                    f"{bs[0]}x{bs[1]}", f"_detail/d{k}", f"_det_{k}.png"], env=env, check=True, capture_output=True)
    o = subprocess.run([PY, "-I", str(HERE / "comfy_run.py"), str(tmp / f"w{k}.json")], capture_output=True, text=True, check=True).stdout
    res = next((CUI / "output" / "_detail").glob(f"d{k}_*.png"))
    new = Image.open(res).convert("RGB").resize(crop.size, Image.LANCZOS)
    soft = m.filter(ImageFilter.GaussianBlur(max(2, int(0.06 * max(bw, bh)))))
    out.paste(Image.composite(new, crop, soft), (cx0, cy0)); res.unlink()
    print("  %s redrawn (%dx%d crop at %d,%d)" % (name, cw, ch, cx0, cy0))
out.save(out_p); print("saved", out_p)
