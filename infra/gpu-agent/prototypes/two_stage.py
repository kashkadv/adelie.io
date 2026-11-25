"""Two stages (2026-11-25): a RICH room first, the real product second.
  A. klein from the block mock-up with a grey mat (scene_proxy.py), START=1 - the model builds a detailed room freely; the
     camera is held by the mock-up; variants where the room moved away from the mock-up (sofa box) are rejected;
  B. the real product goes onto the model's grey mat (place_on_placeholder.py: fitted to the mat's 4 corners, pile thickness,
     light from the room, floor repainted under the edge);
  C. a weak whole-frame pass (START=RELIGHT of 8) for light, shadows and the pile side; blend_into_model.py puts the ORIGINAL
     top surface back with the brightness of pass C (pattern and fibres from the photo).
Usage: two_stage.py workdir style.json seeds...   (workdir: main.png + main_sofa_box.txt from scene_proxy.py, cut_c.png with
       thickness, cut_flat.png without)"""
import json, os, shutil, subprocess, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent; CUI = Path.home() / "ComfyUI"; INP = CUI / "input"; OUT = CUI / "output"
PY = str(CUI / "venv/bin/python")
work = Path(sys.argv[1]); style = json.load(open(sys.argv[2]))["style"]; seeds = [int(x) for x in sys.argv[3:]]
name = work.name; RELIGHT = os.environ.get("RELIGHT", "5"); raw = OUT / f"ts_{name}"

def run(cmd, env=None):
    e = dict(os.environ); e.update(env or {}); r = subprocess.run(list(map(str, cmd)), env=e, capture_output=True, text=True)
    if r.returncode: print(r.stdout[-1500:], r.stderr[-2500:]); raise SystemExit("failed " + str(cmd[:3]))
    return r.stdout

def free():
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8188/free", b'{"unload_models":true,"free_memory":true}',
                                                  {"Content-Type": "application/json"}), timeout=30).read()

def klein(seed, prompt_file, image, prefix, start):
    wf = work / f"ts_{prefix.replace('/', '_')}.json"
    run([sys.executable, "-I", HERE / "wf_klein.py", wf, seed, prompt_file, "832x1248", f"ts_{name}/{prefix}", image],
        env={"STEPS": "8", "START": str(start)})
    o = run([sys.executable, "-I", HERE / "comfy_run.py", wf])
    return raw / [l.split()[-1] for l in o.splitlines() if l.startswith("output:")][0]

room = style["room"].replace("professional architectural photography, ", "").replace("35mm lens, ", "")
pA = ("Image 1 is a rough grey block mock-up of a room seen from standing height. Turn it into a photorealistic, richly detailed "
      "interior, keeping the camera and the layout: the large grey block becomes " + style["sofa"] + " of the same size in the "
      "same place; the light area at the top becomes the wall; the floor becomes " + style["floor"] + " running in the same "
      "direction; the flat grey rectangle on the floor stays a plain flat matte grey mat in exactly the same place, size and "
      "shape, nothing on it. " + room + " No other rugs or carpets anywhere. No people, no text, no logos.")
pC = ("Keep this photograph exactly as it is: the same room, furniture, rug, colours and composition. Only make the light natural "
      "and consistent: the light and shadows of the room fall naturally across the rug lying on the floor, the rug's fluffy wool "
      "edge is lit like the room, with a soft contact shadow along its edges.")
(work / "pA.txt").write_text(pA); (work / "pC.txt").write_text(pC)
shutil.copy(work / "main.png", INP / f"{name}_proxy.png")
free()
A = {s: klein(s, work / "pA.txt", f"{name}_proxy.png", f"a{s}", 1) for s in seeds}
free()
rep = run([PY, "-I", HERE / "gate_variants.py", work / "cut_c.png", *A.values()],
          env={"ALIGN_MIN": "-1", "PROXY_SOFA": (work / "main_sofa_box.txt").read_text().strip(), "PROXY_TOL": os.environ.get("PROXY_TOL", "0.25")})
print(rep); (work / "gates_A.txt").write_text(rep)
bad = {l.split()[0] for l in rep.splitlines() if l.strip() and not l.rstrip().endswith(" ok")}
keep = [s for s in seeds if A[s].name not in bad]; print("rooms kept:", keep)
for s in keep:
    x2 = work / f"ts_a{s}_x2.png"; comp = work / f"ts_c{s}.png"
    run([PY, "-I", HERE / "scene_up2x.py", A[s], x2])
    run([PY, "-I", HERE / "place_on_placeholder.py", x2, work / "cut_c.png", comp])
    shutil.copy(comp, INP / f"{name}_c{s}.png")
free()
C = {s: klein(s + 1000, work / "pC.txt", f"{name}_c{s}.png", f"c{s}", RELIGHT) for s in keep}
free()
for s in keep:
    cx2 = work / f"ts_r{s}_x2.png"
    run([PY, "-I", HERE / "scene_up2x.py", C[s], cx2])
    # the relit frame came from a 1 MP copy of the composite: put the original top surface back with its brightness
    run([PY, "-I", HERE / "blend_into_model.py", cx2, work / "cut_flat.png", OUT / f"{name}_2stage_{s}.png"],
        env={"SIG": "8", "GMIN": "0.35", "GMAX": "1.25", "IN0": "1", "IN1": "6"})
# intermediate frames stay in output for the owner: rooms with the grey mat (A), composites (B), relit frames (C)
steps = OUT / f"{name}_steps"; steps.mkdir(exist_ok=True)
for f in raw.glob("*.png"): shutil.copy(f, steps / ("1_room_" + f.name if f.name.startswith("a") else "3_relit_" + f.name))
for s in keep: shutil.copy(work / f"ts_c{s}.png", steps / f"2_rug_placed_{s}.png")
shutil.rmtree(work / "ts_raw", ignore_errors=True); shutil.move(str(raw), work / "ts_raw")
print("done", [f"{name}_2stage_{s}.png" for s in keep])
