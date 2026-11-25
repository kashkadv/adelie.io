"""'New interior' recipe end to end, no Claude/OpenAI involved: one product photo set -> K finished frames.

Steps (each one is a script in this folder):
  1. sam_stage1.py      GroundingDINO + SAM2 mask of the product on the MAIN photo (prompt from the category noun)
  2. pipeline_full.py   HR-matting cutout (mode: CORE=10 solid by default)
  3. dehaze_alpha.py, decontaminate_edge.py   clean the cutout edge
  4. placement 'floor': crop around the product (product ~70 % of the width) + neutral_base.py (no old room left)
     placement 'sofa' : the photo as is (the furniture under the product stays; the model restyles it)
  5. FLUX.2 klein multi-reference edit from the main image (START=1 of 8 steps), N seeds
  6. check_alignment.py rejects variants where the model moved/redrew the product; score_layout.py sorts floor items
  7. best K: scene_up2x.py -> clean_leftover.py -> enhance_product.py -> blend_into_model.py (OUTSIDE, narrow fade)

Usage: recipe_interior.py config.json      (see recipes/*.json; paths in the config are absolute or relative to ~/ComfyUI/input)
Needs: ComfyUI running on 127.0.0.1:8188; ~/ComfyUI/venv (GPU tools) and ~/birefnet-test (matting)."""
import json, os, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home(); CUI = HOME / "ComfyUI"; INP = CUI / "input"; OUT = CUI / "output"
PY = str(CUI / "venv/bin/python"); PYM = str(HOME / "birefnet-test/bin/python")

PROMPTS = {
    "floor": ("Keep the {noun} in image 1 exactly as it is: the same position, size, shape, pattern, colours, texture and edges. "
              "Replace everything around it with a warm, cozy, homely living room: a warm light oak wooden floor; a beige linen sofa "
              "with soft cushions and a knitted throw standing right behind the {noun}, its front edge exactly parallel to the long "
              "side of the {noun} and centred on it: the middle of the sofa is exactly behind the middle of the {noun}, a symmetric "
              "composition, the whole sofa is in the frame; a warm cream wall with a window with sheer curtains; a wooden side table "
              "with a warm table lamp and a green plant in a pot. Soft, warm, diffused daylight: no direct sun, no hard shadows, no "
              "stripes of sunlight on the floor. The {noun} lies flat on the floor with a soft natural contact shadow. The other "
              "images show the same {noun} for reference. Sharp focus, crisp detail, realistic interior photography."),
    "sofa": ("Keep the {noun} in image 1 exactly as it is: the same position, size, shape, colours, pattern and fur. Turn the sofa "
             "under it into a cozy beige linen sofa of the same shape in exactly the same place, with a knitted throw; replace the "
             "plain wall with a warm, cozy, homely living room: a warm cream wall, a window with sheer curtains, a wooden side table "
             "with a warm table lamp, a green plant, a light oak wooden floor. Soft, warm, diffused daylight: no direct sun, no hard "
             "shadows. The {noun} rests naturally on the sofa with a soft contact shadow. The other images show the same {noun} for "
             "reference. Sharp focus, crisp detail, realistic interior photography."),
}

def run(cmd, env=None, cwd=None, quiet=False):
    e = dict(os.environ); e.update(env or {})
    r = subprocess.run(cmd, env=e, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-3000:]); raise SystemExit("failed: " + " ".join(map(str, cmd)))
    if not quiet and r.stdout.strip(): print("   ", r.stdout.strip().splitlines()[-1])
    return r.stdout

def free_comfy():
    """ComfyUI keeps klein in VRAM; 8 GB is not enough for it plus matting / ESRGAN / LaMa outside ComfyUI."""
    import urllib.request
    try:
        req = urllib.request.Request("http://127.0.0.1:8188/free", json.dumps({"unload_models": True, "free_memory": True}).encode(),
                                     {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        print("    (could not free ComfyUI memory:", e, ")")

def latent_size(w, h):
    """~1 MP, sides multiple of 16, same aspect as the main image."""
    k = (1_000_000 / (w * h)) ** 0.5
    return int(round(w * k / 16) * 16), int(round(h * k / 16) * 16)

def main(cfg_path):
    cfg = json.load(open(cfg_path)); name = cfg["name"]
    src = Path(cfg["folder"]); src = src if src.is_absolute() else INP / src
    work = CUI / "work" / name; work.mkdir(parents=True, exist_ok=True)
    etap = OUT / "etap0"; etap.mkdir(exist_ok=True)       # sam_stage1 / pipeline_full write here; moved to work/ afterwards
    from PIL import Image
    print("==", name); free_comfy()
    # 1-2. mask and cutout on the main photo
    Image.open(src / cfg["main"]).convert("RGB").save(INP / "gushka" / f"{name}.jpg", quality=97)
    run([PY, "-I", str(HERE / "sam_stage1.py"), f"{name}={cfg['noun_en']}."], cwd=HERE)
    run([PYM, "-I", str(HERE / "pipeline_full.py"), name], env={"MASKS": str(etap), "CORE": str(cfg.get("core", 10)), "TAG": "_solid"}, cwd=HERE)
    for f in etap.glob(f"{name}_*"): shutil.move(str(f), work / f.name)
    photo = work / "photo.png"; Image.open(INP / "gushka" / f"{name}.jpg").save(photo)
    # 3. clean edge
    run([PY, "-I", str(HERE / "dehaze_alpha.py"), str(work / f"{name}_solid_cutout.png"), str(work / "cut_dh.png")])
    run([PY, "-I", str(HERE / "decontaminate_edge.py"), str(photo), str(work / "cut_dh.png"), str(work / "cut.png")])
    # 4. main image for the model
    import numpy as np
    cut = Image.open(work / "cut.png"); ph = Image.open(photo)
    if cfg["placement"] == "floor" and cfg.get("rectify"):
        r = cfg["rectify"]                                   # real size + rotation on the floor + camera (rectify_place.py)
        run([PY, "-I", str(HERE / "rectify_place.py"), str(photo), str(work / "cut.png"), str(work / "photo_c.png"), str(work / "cut_c.png")],
            env={"SIZE": r["size_cm"], "ROT": str(r.get("rot", 0)), "ELEV": str(r.get("elev", 50)),
                 "ROOM_CM": str(r.get("room_cm", 380)), "CANVAS": r.get("canvas", "1200x1800")})
        run([PY, "-I", str(HERE / "neutral_base.py"), str(work / "photo_c.png"), str(work / "cut_c.png"), str(work / "main.png")])
    elif cfg["placement"] == "floor":
        a = np.asarray(cut.split()[3]) > 128; ys, xs = np.nonzero(a)
        pw = (xs.max() - xs.min()) / cfg.get("product_share", 0.7); ar = cfg.get("aspect", 2 / 3)
        fw, fh = pw, pw / ar; cx = (xs.max() + xs.min()) / 2; cy = (ys.max() + ys.min()) / 2
        box = [int(cx - fw / 2), int(cy - fh * 0.62), int(cx + fw / 2), int(cy + fh * 0.38)]
        def crop_pad(im, fill):
            canvas = Image.new(im.mode, (box[2] - box[0], box[3] - box[1]), fill); canvas.paste(im, (-box[0], -box[1])); return canvas
        crop_pad(ph, (200, 190, 175)).save(work / "photo_c.png"); crop_pad(cut, (0, 0, 0, 0)).save(work / "cut_c.png")
        run([PY, "-I", str(HERE / "neutral_base.py"), str(work / "photo_c.png"), str(work / "cut_c.png"), str(work / "main.png")])
    else:
        ph.save(work / "photo_c.png"); cut.save(work / "cut_c.png"); ph.save(work / "main.png")
    photo_c, cut_c = work / "photo_c.png", work / "cut_c.png"
    # 5. klein variants
    main_in = f"{name}_main.png"; shutil.copy(work / "main.png", INP / main_in)
    refs = []
    for i, r in enumerate(cfg.get("refs", [])):
        refs.append(f"{name}_ref{i}.png"); Image.open(src / r).convert("RGB").save(INP / refs[-1])
    (work / "prompt.txt").write_text(PROMPTS[cfg["placement"]].format(noun=cfg["noun_en"].removeprefix("a ").removeprefix("an ")))
    W, H = Image.open(work / "main.png").size; lw, lh = latent_size(W, H)
    variants = []
    for seed in cfg.get("seeds", [901, 902, 903, 904, 905, 906]):
        wf = work / f"wf_{seed}.json"
        run([sys.executable, "-I", str(HERE / "wf_klein.py"), str(wf), str(seed), str(work / "prompt.txt"), f"{lw}x{lh}",
             f"work_{name}/v{seed}", main_in, *refs], env={"STEPS": "8", "START": "1"}, quiet=True)
        out = run([sys.executable, "-I", str(HERE / "comfy_run.py"), str(wf)], quiet=True)
        f = [l.split()[-1] for l in out.splitlines() if l.startswith("output:")][0]
        variants.append(OUT / f"work_{name}" / f); print("    variant", seed, out.splitlines()[0])
    free_comfy()
    # 6. reject moved products, sort
    al = {l.split()[1]: float(l.split()[0]) for l in run([PY, "-I", str(HERE / "check_alignment.py"), str(cut_c), *map(str, variants)], quiet=True).splitlines() if l.strip()}
    # a variant where the model left part of the floor as a plain, texture-free patch (it happens on some seeds)
    from scipy import ndimage as ndi
    def flat_share(p):
        g = np.asarray(Image.open(p).convert("L")).astype(float); h = g.shape[0]
        m = ndi.uniform_filter(g, 9); sd = np.sqrt(np.clip(ndi.uniform_filter(g * g, 9) - m * m, 0, None))
        return (sd[int(h * 0.7):] < 1.2).mean()
    flat = {v.name: flat_share(v) for v in variants}
    ok = [v for v in variants if al[v.name] >= cfg.get("align_min", 0.22) and flat[v.name] < 0.2]
    print("    flat floor:", {k[:9]: round(v, 2) for k, v in flat.items()})
    print("    alignment:", {k[:9]: round(v, 2) for k, v in al.items()}, "->", len(ok), "kept")
    if cfg["placement"] == "floor" and ok:
        lines = run([PY, "-I", str(HERE / "score_layout.py"), str(cut_c), "a sofa.", *map(str, ok)], quiet=True).splitlines()
        order = [l.split()[1] for l in lines if l[:1].isdigit()]
        ok = sorted(ok, key=lambda v: order.index(v.name) if v.name in order else 99)
    else:
        ok = sorted(ok, key=lambda v: -al[v.name])
    # 7. finish the best K
    enh = work / "cut_enh.png"
    run([PY, "-I", str(HERE / "enhance_product.py"), str(photo_c), str(cut_c), str(enh)])
    for k, v in enumerate(ok[: cfg.get("keep", 2)], 1):
        x2, clean, fin = work / f"{v.stem}_x2.png", work / f"{v.stem}_clean.png", OUT / f"{name}_{k}.png"
        run([PY, "-I", str(HERE / "scene_up2x.py"), str(v), str(x2)], quiet=True)
        run([PY, "-I", str(HERE / "clean_leftover.py"), str(x2), str(cut_c), str(clean)], quiet=True)
        run([PY, "-I", str(HERE / "blend_into_model.py"), str(x2), str(enh), str(fin)],
            env={"OUTSIDE": str(clean), "IN0": "2", "IN1": "8", "CONTACT": "0.25", "SIG": "20"})
    shutil.rmtree(work / "variants", ignore_errors=True)
    shutil.move(str(OUT / f"work_{name}"), work / "variants")          # all raw variants stay for review in ~/ComfyUI/work/<name>
    try: etap.rmdir()
    except OSError: pass
    print("== done", name)

if __name__ == "__main__":
    for c in sys.argv[1:]:
        main(c)
