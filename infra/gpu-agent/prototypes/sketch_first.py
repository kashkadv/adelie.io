"""Owner's idea (2026-11-25): sketch first, then the interior around the REAL product, the product itself locked.
  1. proxy room in real cm (scene_proxy.py) with the real rectified product lying in it instead of a grey mat;
  2. klein from that image, START=1, with a latent noise mask: the model may repaint everything EXCEPT the product body;
  3. a weak whole-frame pass (START=RELIGHT of 8) only for light and shadows falling on the product;
  4. back on the product: brightness of pass 3 over the original pixels (pattern and fibres from the photo), everything else
     from pass 3.
Usage: sketch_first.py workdir style.json seeds...   (workdir has photo_c.png / cut_c.png from rectify_place.py)"""
import json, os, shutil, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent; CUI = Path.home() / "ComfyUI"; INP = CUI / "input"; OUT = CUI / "output"
PY = str(CUI / "venv/bin/python")
work = Path(sys.argv[1]); style = json.load(open(sys.argv[2]))["style"]; seeds = [int(x) for x in sys.argv[3:]]
name = work.name; RELIGHT = os.environ.get("RELIGHT", "5")

def run(cmd, env=None):
    e = dict(os.environ); e.update(env or {}); r = subprocess.run(cmd, env=e, capture_output=True, text=True)
    if r.returncode: print(r.stdout[-1500:], r.stderr[-2500:]); raise SystemExit("failed " + str(cmd[:3]))
    return r.stdout

def free():
    import urllib.request
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8188/free", b'{"unload_models":true,"free_memory":true}',
                                                  {"Content-Type": "application/json"}), timeout=30).read()

cut = Image.open(work / "cut_c.png").convert("RGBA"); W, H = cut.size
a = np.asarray(cut.split()[3]) / 255.0
# 1. sketch with the real product
sk = Image.open(work / "main.png").convert("RGBA"); sk.alpha_composite(cut); sk = sk.convert("RGB")
sk.save(work / "sketch.png"); sk.save(INP / f"{name}_sketch.png")
# locked = the TOP surface of the product only (cut_flat.png when thickness was added): the pile side and the fringe are left
# to the model, so it renders them in the room's light (a fibrous side instead of a flat band)
flat = work / "cut_flat.png"
top = np.asarray(Image.open(flat).convert("RGBA").split()[3]) / 255.0 if flat.exists() else a
body = ndi.binary_erosion(top > 0.9, iterations=3)
Image.fromarray(((~body) * 255).astype(np.uint8)).convert("RGB").save(INP / f"{name}_lock.png")
p1 = ("Image 1 is a rough mock-up of a room with a real rug lying on the floor. Turn the mock-up into a photorealistic interior, "
      "keeping every object exactly in its place and at its size: the large grey block becomes " + style["sofa"] + ", exactly the "
      "same size, shape and position; the light area at the top becomes the wall; the floor becomes " + style["floor"] + " running "
      "in the same direction. The rug on the floor stays exactly as it is. Keep the camera exactly as in image 1: the same high "
      "viewpoint looking down at the floor, the same perspective. " + style["room"].replace("professional architectural photography, ", "").replace("35mm lens, ", "") + " No other rugs or carpets anywhere. "
      "No people, no text, no logos.")
p2 = ("Keep this photograph exactly as it is: the same room, furniture, rug, colours and composition. Only make the light "
      "natural and consistent: the sunlight and the shadows of the room fall naturally across the rug lying on the floor, "
      "with a soft contact shadow along its edges.")
(work / "p1.txt").write_text(p1); (work / "p2.txt").write_text(p2)
free()
from PIL import Image as _I
lw, lh = 832, 1248
for seed in seeds:
    wf = work / f"sf_{seed}.json"
    run([sys.executable, "-I", str(HERE / "wf_klein.py"), str(wf), str(seed), str(work / "p1.txt"), f"{lw}x{lh}", f"sf_{name}/a{seed}_s" + os.environ.get("START1", "2"),
         f"{name}_sketch.png"], env={"STEPS": "8", "START": os.environ.get("START1", "2"), "MASK": f"{name}_lock.png"})
    o = run([sys.executable, "-I", str(HERE / "comfy_run.py"), str(wf)])
    fa = OUT / f"sf_{name}" / [l.split()[-1] for l in o.splitlines() if l.startswith("output:")][0]
    shutil.copy(fa, INP / f"{name}_a{seed}.png")
    wf2 = work / f"sf2_{seed}.json"
    run([sys.executable, "-I", str(HERE / "wf_klein.py"), str(wf2), str(seed + 1000), str(work / "p2.txt"), f"{lw}x{lh}",
         f"sf_{name}/b{seed}", f"{name}_a{seed}.png"], env={"STEPS": "8", "START": RELIGHT})
    o = run([sys.executable, "-I", str(HERE / "comfy_run.py"), str(wf2)])
    fb = OUT / f"sf_{name}" / [l.split()[-1] for l in o.splitlines() if l.startswith("output:")][0]
    print("seed", seed, "->", fa.name, fb.name)
free()
keep = list(seeds)
box = work / "main_sofa_box.txt"
if box.exists():
    fbs = [sorted((OUT / f"sf_{name}").glob(f"b{s_}_*.png"))[-1] for s_ in seeds]
    rep_ = run([PY, "-I", str(HERE / "gate_variants.py"), str(work / "cut_c.png"), *map(str, fbs)],
               env={"ALIGN_MIN": "-1", "PROXY_SOFA": box.read_text().strip(), "PROXY_TOL": os.environ.get("PROXY_TOL", "0.2")})
    (work / "gates.txt").write_text(rep_); print(rep_)
    bad = {l.split()[0] for l in rep_.splitlines() if l.strip() and not l.rstrip().endswith(" ok")}
    keep = [s_ for s_, fb in zip(seeds, fbs) if fb.name not in bad]
    print("kept seeds:", keep)
for seed in keep:
    fb = sorted((OUT / f"sf_{name}").glob(f"b{seed}_*.png"))[-1]
    x2 = work / f"sf_b{seed}_x2.png"
    run([PY, "-I", str(HERE / "scene_up2x.py"), str(fb), str(x2)])
    run([PY, "-I", str(HERE / "blend_into_model.py"), str(x2), str(flat if flat.exists() else work / "cut_c.png"), str(OUT / f"{name}_sketch_{seed}.png")],
        env={"SIG": "8", "GMIN": "0.35", "GMAX": "1.25", "IN0": "1", "IN1": "6"})
shutil.rmtree(work / "sf_raw", ignore_errors=True); shutil.move(str(OUT / f"sf_{name}"), work / "sf_raw")
print("done")
