"""Adelie GPU agent (ADR-0041, ADR-0042): runs on the owner's PC next to ComfyUI and calls Adelie itself (pull) - Adelie
never connects to the PC. Every ~30 s a heartbeat (ready / busy, free VRAM); when ready it claims a job, runs it locally and
uploads the result.

Ready = the owner's switch is on (no file ~/.adelie-gpu-off) and at least MIN_VRAM_MB of video memory is free.

Jobs:
  scene_refine     - one scene edited by the owner's instruction (FLUX 3 Klein, the scene as image 1); with the owner's
                     mask ("Refine an area") the area is tinted red for the model and only it is pasted back.
  scene_candidates - a room mock-up in real centimetres (prototypes/scene_proxy.py) dressed by FLUX 3 Image Klein
                     (prototypes/wf_flux3.py); one scene per seed, uploaded with its recipe. The prompt and the mock-up
                     come with the job (built in Adelie from the project's rules); scene_prompt() is the fallback.

Usage:  ADELIE_API=https://api.dev.adelie.space ADELIE_GPU_KEY=gpw_... python3 infra/gpu-agent/agent.py
env:    COMFY (default http://127.0.0.1:8188), COMFY_DIR (~/ComfyUI), COMFY_PY (<COMFY_DIR>/venv/bin/python),
        MIN_VRAM_MB 6000, AGENT_MODEL flux3 | klein4b | klein9b, ONCE=1 (one claim then exit - for testing)
The settings usually come from ~/.config/adelie/gpu-agent.env (the "Adelie GPU" app writes it; systemd reads it).
State for the app: ~/.cache/adelie/gpu-agent.json (connection, state, current job, recent jobs).
Standard library only."""
import base64, json, os, shutil, subprocess, sys, threading, time, traceback, urllib.error, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent; PROTO = HERE / "prototypes"; RECIPES = PROTO / "recipes"
API = os.environ.get("ADELIE_API", "http://localhost:4000").rstrip("/")
KEY = os.environ.get("ADELIE_GPU_KEY", "")
COMFY = os.environ.get("COMFY", "http://127.0.0.1:8188")
COMFY_DIR = Path(os.environ.get("COMFY_DIR", Path.home() / "ComfyUI"))
PY = os.environ.get("COMFY_PY", str(COMFY_DIR / "venv/bin/python"))
MIN_VRAM = int(os.environ.get("MIN_VRAM_MB", 6000))
SWITCH_OFF = Path.home() / ".adelie-gpu-off"
AGENT_MODEL = os.environ.get("AGENT_MODEL", "flux3")
MODEL = {"flux3": "flux3-image-klein-int8", "klein4b": "flux2-klein-4b-fp8", "klein9b": "flux2-klein-9b-fp8"}.get(
    AGENT_MODEL, "flux3-image-klein-int8")
STATE_FILE = Path.home() / ".cache/adelie/gpu-agent.json"
_status = {"pid": os.getpid(), "model": MODEL, "history": []}
_lock = threading.Lock()


def report(**kw):
    """What the app shows: merged into the state file (written atomically)."""
    with _lock:
        _status.update(kw, updated=time.time())
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp"); tmp.write_text(json.dumps(_status)); tmp.replace(STATE_FILE)


def call(path, body=None, data=None, headers=None, timeout=60):
    """POST to the Adelie API with the worker key: a JSON body or raw bytes; JSON back (None on 204)."""
    # Cloudflare in front of the API refuses the default Python-urllib user agent (403)
    h = {"Authorization": f"Bearer {KEY}", "User-Agent": "adelie-gpu-agent/1", **(headers or {})}
    if data is None:
        data = json.dumps(body if body is not None else {}).encode(); h["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def fetch(path, timeout=120):
    """GET bytes from the Adelie API with the worker key (the image a refine job edits)."""
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {KEY}", "User-Agent": "adelie-gpu-agent/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def vram_free_mb():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        return int(out.split()[0])
    except Exception:
        return None


def state():
    """ready / busy and free VRAM. ComfyUI's own loaded models count as free (we unload them before a job)."""
    if SWITCH_OFF.exists():
        return "busy", vram_free_mb()
    free = vram_free_mb()
    return ("ready" if free is None or free >= MIN_VRAM else "busy"), free


def heartbeat():
    st, free = state()
    try:
        call("/gpu/heartbeat", {"state": st, "vramFreeMb": free, "info": {"agent": 1, "model": MODEL}})
        report(connected=True, connError=None, lastBeat=time.time(), state=st, vramFreeMb=free)
    except Exception as e:
        print("heartbeat failed:", e, flush=True)
        report(connected=False, connError=str(e)[:200], state=st, vramFreeMb=free)
    return st


class Progress:
    """Live progress of a job for Adelie: overall % from finished scenes plus the current scene's sampling step
    (ComfyUI's websocket, via comfy_run.py's PROGRESS_FILE), sent every few seconds while the PC works."""

    def __init__(self, jid, total):
        self.jid, self.total, self.done, self.stage = jid, max(1, total), 0, "mockup"
        self.file = Path(f"/tmp/adelie-progress-{jid}.json"); self.file.unlink(missing_ok=True)
        self.stop = threading.Event(); self.last = None
        threading.Thread(target=self.loop, daemon=True).start()

    def percent(self):
        step = 0.0
        if self.stage == "generating":
            try:
                d = json.loads(self.file.read_text()); step = d["value"] / max(1, d["max"])
            except Exception:
                pass
        elif self.stage == "uploading":
            step = 1.0
        return min(99, round(100 * (self.done + step) / self.total))

    def send(self):
        # before the first sampling step ComfyUI is loading the model (~20-30 s on the first scene)
        stage = "loading" if self.stage == "generating" and not self.file.exists() else self.stage
        now = (self.percent(), stage)
        if now != self.last:
            try:
                call(f"/gpu/jobs/{self.jid}/progress", {"progress": now[0], "stage": now[1]}, timeout=10)
                self.last = now
            except Exception:
                pass

    def loop(self):
        while not self.stop.wait(4):
            self.send()

    def set(self, stage=None, done=None):
        if stage is not None: self.stage = stage
        if done is not None: self.done = done
        if stage in ("generating",): self.file.unlink(missing_ok=True)
        self.send()

    def close(self):
        self.stop.set(); self.file.unlink(missing_ok=True)


def comfy_free():
    try:
        urllib.request.urlopen(urllib.request.Request(COMFY + "/free", b'{"unload_models":true,"free_memory":true}',
                                                      {"Content-Type": "application/json"}), timeout=30).read()
    except Exception:
        pass


def run(cmd, env=None, cwd=None):
    e = dict(os.environ); e.update(env or {})
    r = subprocess.run([str(c) for c in cmd], env=e, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"{Path(str(cmd[2])).name}: {(r.stderr or r.stdout)[-800:]}")
    return r.stdout


# --- scene_candidates -------------------------------------------------------------------------------------------------

SIZE_MOCK = {"small": "100x150", "medium": "160x230", "large": "200x300", "runner": "70x250"}
# What the big block in the mock-up is, per room type, and its size (cm W x D x H)
KIND = {
    "living": ("a soft upholstered sofa", "220x90x80", True),
    "reading": ("a soft upholstered sofa", "200x90x80", True),
    "lobby": ("a long upholstered lounge sofa", "240x95x80", True),
    "other": ("a sofa", "220x90x80", True),
    "bedroom": ("a bed with an upholstered headboard and linen bedding, its foot towards the open floor", "180x210x95", False),
    "hotel_room": ("a hotel bed with an upholstered headboard and crisp bedding, its foot towards the open floor",
                   "180x210x100", False),
    "kids": ("a low daybed with cushions", "190x90x70", False),
    "hall": ("a low wooden bench", "120x40x45", False),
    "kitchen": ("a long wooden dining table with chairs", "200x90x75", False),
}
ROOM_NAME = {"living": "living room", "reading": "reading corner", "lobby": "hotel lobby", "other": "room",
             "bedroom": "bedroom", "hotel_room": "hotel room", "kids": "kids' room", "hall": "hallway",
             "kitchen": "dining room"}
LIGHT = {
    "sun": "Warm late-afternoon sunlight through sheer linen curtains, long soft shadows across the floor.",
    "evening": "Evening: soft warm light from table and floor lamps switched on, gentle shadows, cosy and calm.",
}


def room_of(p):
    """The scene type: chosen per job inside a location; older jobs said `room` or used the location's kind."""
    return p.get("sceneType") or p.get("room") or (p.get("location") or {}).get("kind") or "living"


def scene_prompt(p):
    loc = p.get("location") or {}
    kind = room_of(p); what, _, armchair = KIND.get(kind, KIND["other"])
    size = SIZE_MOCK[p["sizeClass"]].replace("x", " x ")
    place = (loc.get("description") or "").strip()
    style = (p.get("style") or "").strip()
    notes = (p.get("notes") or "").strip()
    parts = [
        f"Image 1 is a grey block mock-up of a {ROOM_NAME.get(kind, 'room')} seen from standing height. Turn it into a real "
        "photograph, keeping the camera and the layout exactly: the light area at the top is the back wall; the floor "
        "boards run in the same direction as the lines on the floor.",
        f"The long grey block is {what}, of the same size in the same place, against the back wall.",
    ]
    if armchair:
        parts.append("The block on the left, beyond its end, is one soft armchair turned 80 to 90 degrees to it, "
                     "symmetrical, both armrests identical. The small table shape by the other end is a real side "
                     "table on slim legs with a lamp and a mug.")
    parts += [
        f"The floor in front of it stays open and bare: a clear area of plain floor about {size} cm, with nothing "
        "standing on it - no table, no rug, no basket, no object, nothing hanging over it.",
        "Every grey block becomes its real object completely; no plain grey boxes remain. Everything at real-world "
        "size and well built, like real products from a good furniture store: straight evenly spaced legs, clean "
        "edges, square corners, true proportions between objects, a sensible layout like a designer's; rectangular "
        "picture frames, a straight curtain rod with evenly hanging curtains, plants with natural leaves. "
        "Throws and blankets lie folded on the seats, nothing hangs down to the floor. Curtains only at windows. "
        "No animals, no people, no rugs or carpets, no text.",
    ]
    if place: parts.append(f"The place: {place}")
    if style: parts.append(f"Style: {style}.")
    parts.append(LIGHT.get(p.get("light", "sun"), LIGHT["sun"]))
    if notes: parts.append(notes)
    parts.append("A real photograph: an unedited photo from a home interior magazine, true-to-life colours, natural "
                 "textures of wood, fabric and plaster, subtle film grain; not a 3D render, not an illustration.")
    return " ".join(parts)


def describe_refs(jid, work, refs, prog):
    """The references in words (FLUX 3 Klein prompt upsampler, a vision-language model); None if it is not installed
    or fails - then the pictures alone go to the image model."""
    if not (COMFY_DIR / "models/text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors").exists():
        return None
    prog.set(stage="describing")
    try:
        comfy_free()
        wf = work / "describe.json"
        run([PY, "-I", PROTO / "wf_describe.py", wf, *[r.name for r in refs]])
        out = run([PY, "-I", PROTO / "comfy_run.py", wf])
        texts = [json.loads(l[len("text: "):]) for l in out.splitlines() if l.startswith("text: ")]
        comfy_free()                                   # the 9B describer out of VRAM before the image model
        text = " ".join(str(t) for t in texts).strip()
        return text[:900] or None
    except Exception as e:
        print("  describing the references failed:", e, flush=True)
        return None


# Scenes are generated at ~2 MP (owner, 2026-11-27: real texture instead of the 1 MP upscale's smoothness)
SIZE_HI = "1152x1728"
REALVIS = "RealVisXL_V5.0_fp16.safetensors"

# Reads the sketch, decides pencil / line / colour, blurs a pencil sketch's hatching, prints {"kind", "size"} where size
# is the sketch's aspect at ~2 MP in multiples of 16.
SKETCH_PREP = r"""
import sys, json
import numpy as np
from PIL import Image, ImageFilter
p = sys.argv[1]; im = Image.open(p).convert("RGB"); a = np.asarray(im).astype(float)
sat = ((a.max(2) - a.min(2)) / (a.max(2) + 1)).mean()
dark = (a.mean(2) < 200).mean()
kind = "colour" if sat > 0.12 else ("line" if dark < 0.12 else "pencil")
if kind == "pencil":
    g = im.convert("L").filter(ImageFilter.GaussianBlur(2.2)).point(lambda v: min(255, int(v * 1.08)))
    g.convert("RGB").save(p)
else:
    im.save(p)
w, h = im.size; k = (2_000_000 / (w * h)) ** 0.5
print(json.dumps({"kind": kind, "size": "%dx%d" % (round(w * k / 16) * 16, round(h * k / 16) * 16)}))
"""


def photo_pass(jid, work, n, seed, img, prompt, prog):
    """The photographic second pass (owner, 2026-11-27): RealVisXL re-photographs the scene at low denoise - matte real
    textures, natural colours - keeping the composition. Skipped if the checkpoint is not installed."""
    if not prompt or not (COMFY_DIR / "models/checkpoints" / REALVIS).exists():
        return img, False
    prog.set(stage="refining")
    src = COMFY_DIR / "input" / f"adelie_{jid}_photo{n}.png"; shutil.copy(img, src)
    (work / "photo.txt").write_text(prompt)
    wf = work / f"photo_{n}.json"
    try:
        comfy_free()
        run([PY, "-I", PROTO / "wf_sdxl_refine.py", wf, seed, work / "photo.txt", src.name, f"adelie/{jid}_{n}_photo"],
            env={"DENOISE": "0.3", "CKPT": REALVIS})
        out = run([PY, "-I", PROTO / "comfy_run.py", wf])
        comfy_free()
        name = [l.split()[-1] for l in out.splitlines() if l.startswith("output:")][0]
        img.unlink(missing_ok=True)
        return COMFY_DIR / "output" / "adelie" / name, True
    except Exception as e:
        print("  photo pass failed:", e, flush=True)
        return img, False
    finally:
        src.unlink(missing_ok=True)


def scene_candidates(job):
    p = job["params"]; jid = job["id"]
    kind = room_of(p)
    _, sofa, armchair = KIND.get(kind, KIND["other"])
    side_table = armchair
    mock = p.get("mockup") or {}                 # since scenes v2 the server sends the scene type's mock-up and prompt
    if mock:
        sofa = mock.get("size") or sofa
        armchair, side_table = bool(mock.get("armchair")), bool(mock.get("sideTable"))
    work = COMFY_DIR / "work" / "adelie" / jid; work.mkdir(parents=True, exist_ok=True)
    blank = work / "blank.png"
    run([PY, "-I", "-c", f"from PIL import Image; Image.new('RGBA',(1200,1800),(0,0,0,0)).save('{blank}')"])
    geo = {"ROT": "90", "ELEV": "35", "ROOM_CM": "380", "CY": "0.72", "SIZE": SIZE_MOCK[p["sizeClass"]],
           "YAW": "20" if p.get("angle") == "side" else "0", "SOFA": sofa, "SLAB": "0",
           "ARMCHAIR": "left" if armchair else "none", "SIDE_TABLE": "right" if side_table else "none",
           "LIGHT": p.get("light", "sun")}
    proxy = work / "proxy.png"
    prog = Progress(jid, len(p.get("seeds") or [1]))
    inp = COMFY_DIR / "input" / f"adelie_{jid}_proxy.png"
    sketch = None
    if p.get("sketchId"):
        # the owner's sketch instead of the block mock-up (owner, 2026-11-27); a pencil sketch with hatching is blurred
        # first - the hatching otherwise comes back as a drawn, rendered look
        inp.write_bytes(fetch(f"/gpu/jobs/{jid}/source"))
        out = run([PY, "-I", "-c", SKETCH_PREP, str(inp)])
        sketch = json.loads(out.strip().splitlines()[-1])
        geo = {"sketch": sketch}
    else:
        run([PY, "-I", PROTO / "scene_proxy.py", blank, proxy], env=geo); shutil.copy(proxy, inp)
    size = sketch["size"] if sketch else SIZE_HI
    prompt = p.get("prompt") or scene_prompt(p); (work / "prompt.txt").write_text(prompt)
    # the owner's references (interiors, materials, mood) go to the model after the mock-up: images 2..
    # The owner's references go to the image model as WORDS only (tested 2026-11-26: the picture itself made the model
    # copy the reference's layout instead of the mock-up's; the words carried the style and kept the layout).
    # A description written before is kept on the file by Adelie; the others are described here once and sent back.
    refs, words = [], []
    known = p.get("refDescriptions") or []
    for i, _ in enumerate(p.get("refAssetIds") or [], 1):
        if i <= len(known) and known[i - 1]:
            words.append(known[i - 1]); continue
        ref = COMFY_DIR / "input" / f"adelie_{jid}_ref{i}.png"; ref.write_bytes(fetch(f"/gpu/jobs/{jid}/refs/{i}"))
        # a smaller picture: the describer reads it faster (≈ 4.5 instead of 6.5 min) and sees the same style
        run([PY, "-I", "-c", f"from PIL import Image; im=Image.open('{ref}').convert('RGB'); im.thumbnail((640, 640)); im.save('{ref}')"])
        text = describe_refs(jid, work, [ref], prog)
        ref.unlink(missing_ok=True)
        if text:
            words.append(text)
            try:
                call(f"/gpu/jobs/{jid}/refs/{i}/description", {"text": text})
            except Exception:
                pass
    ref_style = " ".join(words) or None
    if ref_style:
        prompt += f" Style details: {ref_style}"
        (work / "prompt.txt").write_text(prompt)
    seeds = p.get("seeds") or [1]
    comfy_free()
    for n, seed in enumerate(seeds, 1):
        prog.set(stage="generating", done=n - 1)
        wf = work / f"wf_{n}.json"
        if AGENT_MODEL == "flux3":
            run([PY, "-I", PROTO / "wf_flux3.py", wf, seed, work / "prompt.txt", size, f"adelie/{jid}_{n}",
                 inp.name], env={"START": "0" if sketch else "2", "STEPS": "16"})
        else:   # FLUX.2 klein for comparisons: 8 steps, the first skipped (the same share)
            run([PY, "-I", PROTO / "wf_klein.py", wf, seed, work / "prompt.txt", "832x1248", f"adelie/{jid}_{n}",
                 inp.name], env={"START": "1", "STEPS": "8", "KLEIN": AGENT_MODEL[-2:]})
        out = run([PY, "-I", PROTO / "comfy_run.py", wf], env={"PROGRESS_FILE": str(prog.file)})
        prog.set(stage="uploading")
        name = [l.split()[-1] for l in out.splitlines() if l.startswith("output:")][0]
        img = COMFY_DIR / "output" / "adelie" / name
        img, refined = photo_pass(jid, work, n, seed, img, p.get("photoPrompt"), prog)
        meta = {"prompt": prompt, "seed": seed, "model": MODEL, "size": size, "photoPass": refined,
                "sketchId": p.get("sketchId"), "refAssetIds": p.get("refAssetIds") or [], "referenceStyle": ref_style,
                "proxy": geo, "mock": SIZE_MOCK[p["sizeClass"]], "kind": kind}
        call(f"/gpu/jobs/{jid}/scenes", data=img.read_bytes(), timeout=300,
             headers={"Content-Type": "image/png", "X-Number": str(n),
                      "X-Meta": base64.b64encode(json.dumps(meta).encode()).decode()})
        img.unlink(missing_ok=True)
        prog.set(stage="saved", done=n)
        report(job={**(_status.get("job") or {}), "done": n})
        print(f"  scene {n}/{len(seeds)} uploaded", flush=True)
    prog.close()
    comfy_free()
    inp.unlink(missing_ok=True)



# "Refine an area" (owner, 2026-11-27). Tested on the PC: hiding the area (grey or blurred fill, noise mask) made FLUX 3
# draw what fits the room there (the window came back) and ignore the request; the original with a semi-transparent
# red tint over the area, edited as a whole like the plain "Refine", did exactly what was asked inside the tint (window
# -> shelves, armchair -> green velvet, a basket on the floor) and left the rest alone. Only the area is then taken
# from the result, so the rest of the frame stays pixel for pixel.
# Prep: the scene brought to the generation size exactly (no crop inside ComfyUI - the result lines up pixel for pixel),
# the owner's mask at that size, and the tinted scene the model is shown. argv: source mask size tinted
AREA_PREP = r"""
import sys
from PIL import Image
src, mask, size, tinted = sys.argv[1:5]
w, h = map(int, size.split("x"))
im = Image.open(src).convert("RGB").resize((w, h), Image.LANCZOS); im.save(src)
m = Image.open(mask).convert("L").resize((w, h), Image.BILINEAR).point(lambda v: 255 if v > 127 else 0); m.save(mask)
Image.composite(Image.blend(im, Image.new("RGB", (w, h), (255, 0, 0)), 0.45), im, m).save(tinted)
"""

# Paste: the area + whatever the model changed right next to it (a basket's handle above the painted box, its shadow -
# cutting it at the box's edge left a see-through ghost), up to ~40% of the area's size further; soft seam.
# argv: generated original mask out
AREA_PASTE = r"""
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
gen, orig, mask, out = sys.argv[1:5]
o = Image.open(orig).convert("RGB"); g = Image.open(gen).convert("RGB").resize(o.size, Image.LANCZOS)
w, h = o.size; r = max(8, round(min(w, h) * 0.02))
m = np.asarray(Image.open(mask).convert("L").resize(o.size)) > 127
blur = lambda im: np.asarray(im.filter(ImageFilter.GaussianBlur(3))).astype(np.float32)
changed = ndi.binary_opening(np.abs(blur(o) - blur(g)).max(2) > 28, iterations=2)
ys, xs = np.nonzero(m)
reach = max(1, int(0.4 * max(xs.max() - xs.min(), ys.max() - ys.min()))) if len(xs) else 1
lab, _ = ndi.label(changed & (ndi.distance_transform_edt(~m) <= reach))
touch = np.unique(lab[ndi.binary_dilation(m, iterations=r) & (lab > 0)])
grown = ndi.binary_closing(m | np.isin(lab, touch[touch > 0]), iterations=max(1, r // 2))
gm = Image.fromarray((grown * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(r)).point(lambda v: 255 if v > 10 else 0)
Image.composite(g, o, gm.filter(ImageFilter.GaussianBlur(r))).save(out)
"""


def scene_refine(job):
    """The owner's instruction applied to one scene: FLUX 3 Klein edits the scene itself (as the reference image), keeping
    camera, layout and the free floor; each seed gives one refined version, uploaded as a new scene. With a mask
    ("Refine an area") the model sees the area tinted red and only the area (and what grew from it) is pasted back."""
    p = job["params"]; jid = job["id"]
    work = COMFY_DIR / "work" / "adelie" / jid; work.mkdir(parents=True, exist_ok=True)
    prog = Progress(jid, len(p.get("seeds") or [1]))
    src = COMFY_DIR / "input" / f"adelie_{jid}_source.png"
    src.write_bytes(fetch(f"/gpu/jobs/{jid}/source"))
    # refine at the scene's own size (scenes are ~2 MP since 2026-11-27)
    ref_size = run([PY, "-I", "-c", f"from PIL import Image; w,h=Image.open('{src}').size; k=min(1.0,(2_000_000/(w*h))**0.5); print('%dx%d'%(round(w*k/16)*16, round(h*k/16)*16))"]).strip()
    mask = tinted = None
    main = src
    if p.get("maskAssetId"):
        mask = work / "mask.png"; tinted = COMFY_DIR / "input" / f"adelie_{jid}_tinted.png"
        mask.write_bytes(fetch(f"/gpu/jobs/{jid}/mask"))
        run([PY, "-I", "-c", AREA_PREP, src, mask, ref_size, tinted])
        main = tinted
    (work / "prompt.txt").write_text(p["prompt"])
    comfy_free()
    seeds = p.get("seeds") or [1]
    for n, seed in enumerate(seeds, 1):
        prog.set(stage="generating", done=n - 1)
        wf = work / f"wf_{n}.json"
        run([PY, "-I", PROTO / "wf_flux3.py", wf, seed, work / "prompt.txt", ref_size, f"adelie/{jid}_{n}", main.name],
            env={"START": "0", "STEPS": "16"})
        out = run([PY, "-I", PROTO / "comfy_run.py", wf], env={"PROGRESS_FILE": str(prog.file)})
        prog.set(stage="uploading")
        name = [l.split()[-1] for l in out.splitlines() if l.startswith("output:")][0]
        img = COMFY_DIR / "output" / "adelie" / name
        if mask:
            pasted = work / f"area_{n}.png"
            run([PY, "-I", "-c", AREA_PASTE, img, src, mask, pasted])
            img.unlink(missing_ok=True); img = pasted
        meta = {"prompt": p["prompt"], "seed": seed, "model": MODEL, "size": ref_size, "instruction": p.get("instruction"),
                "parentSceneId": p.get("parentSceneId"), "proxy": p.get("proxy"), "area": bool(mask)}
        call(f"/gpu/jobs/{jid}/scenes", data=img.read_bytes(), timeout=300,
             headers={"Content-Type": "image/png", "X-Number": str(n),
                      "X-Meta": base64.b64encode(json.dumps(meta).encode()).decode()})
        img.unlink(missing_ok=True)
        prog.set(stage="saved", done=n)
        print(f"  refined {n}/{len(seeds)} uploaded", flush=True)
    prog.close()
    comfy_free()
    src.unlink(missing_ok=True)
    if tinted: tinted.unlink(missing_ok=True)


JOBS = {"scene_candidates": scene_candidates, "scene_refine": scene_refine}


def goodbye(*_):
    """On stop (systemd sends SIGTERM): tell Adelie at once, so the PC shows offline without the 90 s timeout."""
    try:
        call("/gpu/heartbeat", {"state": "offline"}, timeout=5)
    except Exception:
        pass
    report(connected=False, state="offline", job=None)
    os._exit(0)


_CODE = [Path(__file__), *sorted(PROTO.glob("*.py"))]
_STAMP = {p: p.stat().st_mtime for p in _CODE if p.exists()}


def code_changed():
    return any(p.exists() and p.stat().st_mtime != t for p, t in _STAMP.items())


def main():
    if not KEY:
        sys.exit("ADELIE_GPU_KEY is not set (Adelie -> Workshop -> Scenes -> Connect a PC)")
    print(f"Adelie GPU agent -> {API}; model {MODEL}; switch off: touch {SWITCH_OFF}", flush=True)
    report(started=time.time(), api=API, job=None)
    import signal
    signal.signal(signal.SIGTERM, goodbye); signal.signal(signal.SIGINT, goodbye)
    def beat():
        while True:
            heartbeat(); time.sleep(30)
    threading.Thread(target=beat, daemon=True).start()
    while True:
        if state()[0] == "ready":
            try:
                job = call("/gpu/claim")
            except urllib.error.HTTPError as e:
                print("claim failed:", e.code, flush=True); job = None
            except Exception as e:
                print("claim failed:", e, flush=True); job = None
            if job:
                print(f"job {job['id']} ({job['kind']})", flush=True)
                p = job.get("params") or {}
                title = " · ".join(x for x in [(p.get("location") or {}).get("name"), p.get("sceneTypeLabel") or room_of(p)] if x)
                info = {"id": job["id"], "kind": job["kind"], "title": title, "total": len(p.get("seeds") or [1]),
                        "done": 0, "started": time.time()}
                report(job=info)
                result, err = "done", None
                try:
                    JOBS[job["kind"]](job)
                    call(f"/gpu/jobs/{job['id']}/done")
                    print("  done", flush=True)
                except Exception as e:
                    traceback.print_exc(); result, err = "failed", str(e)[:300]
                    try:
                        call(f"/gpu/jobs/{job['id']}/fail", {"error": str(e)[:1500]})
                    except Exception:
                        pass
                done = {**(_status.get("job") or info), "result": result, "error": err, "finished": time.time()}
                report(job=None, history=([done] + _status["history"])[:10])
                if os.environ.get("ONCE"):
                    return
                continue
            if os.environ.get("ONCE"):
                return
        if code_changed():
            # the agent's code was updated (git pull, deploy): restart between jobs so the next job runs the new code
            # (2026-11-27: a job with a sketch ran on the old code, which ignored the sketch)
            print("agent code changed - restarting", flush=True)
            os.execv(sys.executable, [sys.executable, "-u", *sys.argv])
        time.sleep(15)


if __name__ == "__main__":
    main()
