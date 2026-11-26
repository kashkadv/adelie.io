"""Photographic second pass (owner, 2026-11-27: scenes looked rendered): an SDXL photorealism checkpoint (RealVisXL V5.0,
OpenRAIL++ - commercial use allowed within its use restrictions) re-photographs a finished scene at low denoise - the
composition stays, surfaces get real photographic texture, light falloff and grain.
Usage: wf_sdxl_refine.py out.json seed prompt.txt image.png prefix   env: DENOISE 0.3, STEPS 30, CFG 5, CKPT"""
import json, os, sys

CKPT = os.environ.get("CKPT", "RealVisXL_V5.0_fp16.safetensors")
NEG = ("3d render, cgi, illustration, painting, drawing, cartoon, plastic, smooth surfaces, oversaturated, "
       "blurry, deformed, text, watermark")

def build(seed, prompt, image, prefix):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "load": {"class_type": "LoadImage", "inputs": {"image": image}},
        "enc": {"class_type": "VAEEncode", "inputs": {"pixels": ["load", 0], "vae": ["ckpt", 2]}},
        "sample": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["enc", 0],
            "seed": seed, "steps": int(os.environ.get("STEPS", 30)), "cfg": float(os.environ.get("CFG", 5)),
            "sampler_name": "dpmpp_2m_sde", "scheduler": "karras", "denoise": float(os.environ.get("DENOISE", 0.3))}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}},
    }

if __name__ == "__main__":
    out, seed, ptxt, image, prefix = sys.argv[1:6]
    json.dump(build(int(seed), open(ptxt).read().strip(), image, prefix), open(out, "w"), indent=1)
    print("written", out)
