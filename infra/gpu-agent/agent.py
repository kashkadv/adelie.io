"""Adelie GPU agent (ADR-0041, ADR-0042): runs on the owner's PC next to ComfyUI and calls Adelie itself (pull) - Adelie
never connects to the PC. Every ~30 s a heartbeat (ready / busy, free VRAM); when ready it claims a job, runs it locally and
uploads the result.

Ready = the owner's switch is on (no file ~/.adelie-gpu-off) and at least MIN_VRAM_MB of video memory is free.

Jobs:
  scene_candidates - a room mock-up in real centimetres (prototypes/scene_proxy.py) dressed by FLUX 3 Image Klein
                     (prototypes/wf_flux3.py); one scene per seed, uploaded with its recipe.

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
    """The room to generate: chosen per job inside a location (a hotel, a chalet); old jobs used the location's kind."""
    return p.get("room") or (p.get("location") or {}).get("kind") or "living"


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


def scene_candidates(job):
    p = job["params"]; jid = job["id"]
    kind = room_of(p)
    _, sofa, armchair = KIND.get(kind, KIND["other"])
    work = COMFY_DIR / "work" / "adelie" / jid; work.mkdir(parents=True, exist_ok=True)
    blank = work / "blank.png"
    run([PY, "-I", "-c", f"from PIL import Image; Image.new('RGBA',(1200,1800),(0,0,0,0)).save('{blank}')"])
    geo = {"ROT": "90", "ELEV": "35", "ROOM_CM": "380", "CY": "0.72", "SIZE": SIZE_MOCK[p["sizeClass"]],
           "YAW": "20" if p.get("angle") == "side" else "0", "SOFA": sofa, "SLAB": "0",
           "ARMCHAIR": "left" if armchair else "none", "SIDE_TABLE": "right" if armchair else "none"}
    proxy = work / "proxy.png"
    run([PY, "-I", PROTO / "scene_proxy.py", blank, proxy], env=geo)
    inp = COMFY_DIR / "input" / f"adelie_{jid}_proxy.png"; shutil.copy(proxy, inp)
    prompt = scene_prompt(p); (work / "prompt.txt").write_text(prompt)
    seeds = p.get("seeds") or [1]
    comfy_free()
    for n, seed in enumerate(seeds, 1):
        wf = work / f"wf_{n}.json"
        if AGENT_MODEL == "flux3":
            run([PY, "-I", PROTO / "wf_flux3.py", wf, seed, work / "prompt.txt", "832x1248", f"adelie/{jid}_{n}",
                 inp.name], env={"START": "2", "STEPS": "16"})
        else:   # FLUX.2 klein for comparisons: 8 steps, the first skipped (the same share)
            run([PY, "-I", PROTO / "wf_klein.py", wf, seed, work / "prompt.txt", "832x1248", f"adelie/{jid}_{n}",
                 inp.name], env={"START": "1", "STEPS": "8", "KLEIN": AGENT_MODEL[-2:]})
        out = run([PY, "-I", PROTO / "comfy_run.py", wf])
        name = [l.split()[-1] for l in out.splitlines() if l.startswith("output:")][0]
        img = COMFY_DIR / "output" / "adelie" / name
        meta = {"prompt": prompt, "seed": seed, "model": MODEL, "size": "832x1248",
                "proxy": geo, "mock": SIZE_MOCK[p["sizeClass"]], "kind": kind}
        call(f"/gpu/jobs/{jid}/scenes", data=img.read_bytes(), timeout=300,
             headers={"Content-Type": "image/png", "X-Number": str(n),
                      "X-Meta": base64.b64encode(json.dumps(meta).encode()).decode()})
        img.unlink(missing_ok=True)
        call(f"/gpu/jobs/{jid}/progress", {"progress": round(100 * n / len(seeds))})
        report(job={**(_status.get("job") or {}), "done": n})
        print(f"  scene {n}/{len(seeds)} uploaded", flush=True)
    comfy_free()
    inp.unlink(missing_ok=True)


JOBS = {"scene_candidates": scene_candidates}


def goodbye(*_):
    """On stop (systemd sends SIGTERM): tell Adelie at once, so the PC shows offline without the 90 s timeout."""
    try:
        call("/gpu/heartbeat", {"state": "offline"}, timeout=5)
    except Exception:
        pass
    report(connected=False, state="offline", job=None)
    os._exit(0)


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
                title = " · ".join(x for x in [(p.get("location") or {}).get("name"), room_of(p)] if x)
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
        time.sleep(15)


if __name__ == "__main__":
    main()
