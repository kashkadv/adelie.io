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
    "floor_placeholder": ("In image 1 a plain flat matte grey felt mat lies on the floor. Keep this grey mat exactly as it is: the same "
              "position, size and shape, plain uniform grey, no pattern, no texture, nothing on it. Replace everything around it with a "
              "warm, cozy, homely living room: a warm light oak wooden floor; a beige linen sofa with soft cushions and a knitted throw "
              "standing right behind the mat, its front edge exactly parallel to the long side of the mat and centred on it, a symmetric "
              "composition, the whole sofa is in the frame; a warm cream wall with a window with sheer curtains; a wooden side table "
              "with a warm table lamp and a green plant in a pot. No other rugs or carpets anywhere. Soft, warm, diffused daylight: no "
              "direct sun, no hard shadows. The mat lies flat on the floor with a soft natural contact shadow. Sharp focus, crisp "
              "detail, realistic interior photography."),
    "floor_proxy": ("Image 1 is a rough grey block mock-up of a room. Turn it into a photorealistic warm, cozy, homely living room, "
              "keeping every object exactly in its place and at its size: the large grey block becomes a beige linen three-seat sofa "
              "with soft cushions and a knitted throw, exactly the same size, shape and position; the light area at the top becomes a "
              "warm cream wall; the floor becomes warm light oak wooden boards running in the same direction; the flat grey rectangle "
              "on the floor stays a plain flat matte grey mat in exactly the same place, size and shape, plain uniform grey, no "
              "pattern, nothing on it. Add a wooden side table with a warm lamp and a green plant beside the sofa. No other rugs or "
              "carpets anywhere. Soft, warm, diffused daylight, no hard shadows. The mat lies flat on the floor with a soft contact "
              "shadow. Sharp focus, crisp detail, realistic interior photography."),
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
        geo = {"SIZE": r["size_cm"], "ROT": str(r.get("rot", 0)), "ELEV": str(r.get("elev", 50)),
               "ROOM_CM": str(r.get("room_cm", 380)), "CANVAS": r.get("canvas", "1200x1800")}
        if cfg.get("proxy"):                                 # a block room in real cm: the furniture scale is fixed by geometry
            run([PY, "-I", str(HERE / "scene_proxy.py"), str(work / "cut_c.png"), str(work / "main.png")], env=geo)
        elif cfg.get("placeholder"):                         # the model sees a grey slab, never the product
            run([PY, "-I", str(HERE / "placeholder_base.py"), str(work / "cut_c.png"), str(work / "main.png")])
        else:
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
    for i, r in enumerate([] if cfg.get("placeholder") else cfg.get("refs", [])):
        refs.append(f"{name}_ref{i}.png"); Image.open(src / r).convert("RGB").save(INP / refs[-1])
    noun = cfg["noun_en"].removeprefix("a ").removeprefix("an ")
    ph_mode = bool(cfg.get("placeholder") or cfg.get("proxy"))
    prompt = PROMPTS["floor_proxy" if cfg.get("proxy") else "floor_placeholder" if ph_mode else cfg["placement"]].format(noun=noun)
    if cfg.get("proxy") and cfg.get("style"):
        # an interior style written by the owner; the model still only dresses the block mock-up and keeps the grey mat
        st = cfg["style"]
        prompt = ("Image 1 is a rough grey block mock-up of a room. Turn it into a photorealistic interior, keeping every object "
                  "exactly in its place and at its size: the large grey block becomes " + st["sofa"] + ", exactly the same size, "
                  "shape and position; the light area at the top becomes the wall; the floor becomes " + st["floor"] + " running "
                  "in the same direction; the flat grey rectangle on the floor stays a plain flat matte grey mat in exactly the "
                  "same place, size and shape, plain uniform grey, no pattern, nothing on it - light and shadows of the room fall "
                  "on it naturally. " + st["room"] + " No other rugs or carpets anywhere. No people, no text, no logos.")
        cfg["placeholder"] = True
    if ph_mode: noun = "mat"
    if cfg.get("rectify") and not cfg.get("proxy"):
        w, h = sorted(float(v) for v in cfg["rectify"]["size_cm"].split("x"))
        prompt += (f" Real sizes: the {noun} is {w / 100:g} by {h / 100:g} metres; the sofa is a large three-seat sofa about 2.2 metres "
                   f"wide and 0.9 metres deep, so the {noun} is almost as long as the sofa.")
    (work / "prompt.txt").write_text(prompt)
    W, H = Image.open(work / "main.png").size; lw, lh = latent_size(W, H)
    variants = []
    for seed in cfg.get("seeds", list(range(901, 901 + cfg.get("n", 6)))):
        wf = work / f"wf_{seed}.json"
        run([sys.executable, "-I", str(HERE / "wf_klein.py"), str(wf), str(seed), str(work / "prompt.txt"), f"{lw}x{lh}",
             f"work_{name}/v{seed}", main_in, *refs], env={"STEPS": "8", "START": "1"}, quiet=True)
        out = run([sys.executable, "-I", str(HERE / "comfy_run.py"), str(wf)], quiet=True)
        f = [l.split()[-1] for l in out.splitlines() if l.startswith("output:")][0]
        variants.append(OUT / f"work_{name}" / f); print("    variant", seed, out.splitlines()[0])
    free_comfy()
    # 6. reject moved products, sort
    from scipy import ndimage as ndi
    if ph_mode:
        # the slab must stay plain grey: low saturation and no texture inside it (else the model drew something on it)
        inner = ndi.binary_erosion(np.asarray(Image.open(cut_c).split()[3]) > 128, iterations=8)
        def slab_ok(p):
            im = Image.open(p).convert("RGB"); m = np.asarray(Image.fromarray(inner).resize(im.size)) > 0
            f = np.asarray(im).astype(float); sat = (f.max(2) - f.min(2)) / (f.max(2) + 1)
            g = f.mean(2); hp = g - ndi.gaussian_filter(g, 3)
            return float(sat[m].mean() < 0.25 and hp[m].std() < 9)    # warm sun and window shadows on the slab are fine
        al = {v.name: slab_ok(v) for v in variants}
    else:
        al = {l.split()[1]: float(l.split()[0]) for l in run([PY, "-I", str(HERE / "check_alignment.py"), str(cut_c), *map(str, variants)], quiet=True).splitlines() if l.strip()}
    # a variant where the model left part of the floor as a plain, texture-free patch (it happens on some seeds)
    from scipy import ndimage as ndi
    def flat_share(p):
        g = np.asarray(Image.open(p).convert("L")).astype(float); h = g.shape[0]
        m = ndi.uniform_filter(g, 9); sd = np.sqrt(np.clip(ndi.uniform_filter(g * g, 9) - m * m, 0, None))
        return (sd[int(h * 0.7):] < 1.2).mean()
    flat = {v.name: flat_share(v) for v in variants}
    ok = [v for v in variants if al[v.name] >= cfg.get("align_min", 0.45) and flat[v.name] < 0.2]
    if cfg["placement"] == "floor" and ok:
        env = {"ALIGN_MIN": "-1" if ph_mode else str(cfg.get("align_min", 0.45))}
        if cfg.get("rectify") and cfg["rectify"].get("parallel_to_sofa", True) and not cfg.get("proxy"):
            env["EXPECT"] = str(round(220 / max(float(v) for v in cfg["rectify"]["size_cm"].split("x")), 3))
        rep = run([PY, "-I", str(HERE / "gate_variants.py"), str(cut_c), *map(str, ok)], env=env, quiet=True)
        (work / "gates.txt").write_text(rep); print("    gates:\n" + "\n".join("      " + l for l in rep.splitlines() if l.strip()))
        passed = {l.split()[0] for l in rep.splitlines() if l.strip().endswith(" ok")}
        ok = [v for v in ok if v.name in passed]
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
    if cfg.get("enhance", True):           # off for fine fluffy wool: ESRGAN + clarity make its pile coarse
        run([PY, "-I", str(HERE / "enhance_product.py"), str(photo_c), str(cut_c), str(enh)])
    else:
        shutil.copy(cut_c, enh)
    for k, v in enumerate(ok[: cfg.get("keep", 2)], 1):
        x2, clean, fin = work / f"{v.stem}_x2.png", work / f"{v.stem}_clean.png", OUT / f"{name}_{k}.png"
        run([PY, "-I", str(HERE / "scene_up2x.py"), str(v), str(x2)], quiet=True)
        if ph_mode:
            run([PY, "-I", str(HERE / "place_on_placeholder.py"), str(x2), str(enh), str(fin)]); continue
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
