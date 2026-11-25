"""FLUX.2 [klein] 4B (Apache 2.0) multi-reference edit workflow for ComfyUI (API format).
The MAIN reference goes first (it is "image 1" in the prompt); extra references follow in order.
Usage: wf_klein.py out.json seed prompt.txt WxH prefix main.png [ref2.png ...]"""
import json, os, sys

def build(seed, prompt, w, h, prefix, images, steps=4, main_mp=1.0, ref_mp=0.6, start=0):
    """start > 0: begin from the MAIN image itself (its latent) and skip the first `start` steps - keeps the composition."""
    # KLEIN=9b: the 9B model (FLUX Non-Commercial License - comparison only, not for publishing) with its Qwen3-8B encoder
    big = os.environ.get("KLEIN", "4b") == "9b"
    g = {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-9b-fp8.safetensors" if big else "flux-2-klein-4b-fp8.safetensors",
                                                         "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_8b_fp8mixed.safetensors" if big else "qwen_3_4b.safetensors",
                                                         "type": "flux2"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["clip", 0]}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
    }
    p, n = ["pos", 0], ["neg", 0]
    for i, img in enumerate(images):
        g[f"load{i}"] = {"class_type": "LoadImage", "inputs": {"image": img}}
        g[f"scale{i}"] = {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": [f"load{i}", 0], "upscale_method": "lanczos",
                          "megapixels": main_mp if i == 0 else ref_mp, "resolution_steps": 16}}
        g[f"enc{i}"] = {"class_type": "VAEEncode", "inputs": {"pixels": [f"scale{i}", 0], "vae": ["vae", 0]}}
        g[f"rp{i}"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": p, "latent": [f"enc{i}", 0]}}
        g[f"rn{i}"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": n, "latent": [f"enc{i}", 0]}}
        p, n = [f"rp{i}", 0], [f"rn{i}", 0]
    g.update({
        "guider": {"class_type": "CFGGuider", "inputs": {"model": ["unet", 0], "positive": p, "negative": n, "cfg": 1.0}},
        "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "sigmas": {"class_type": "Flux2Scheduler", "inputs": {"steps": steps, "width": w, "height": h}},
        "latent": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "sample": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["noise", 0], "guider": ["guider", 0], "sampler": ["sampler", 0],
                   "sigmas": ["split", 1] if start else ["sigmas", 0], "latent_image": ["enc0", 0] if start else ["latent", 0]}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}},
    })
    if start:
        g["split"] = {"class_type": "SplitSigmas", "inputs": {"sigmas": ["sigmas", 0], "step": start}}
    if start and os.environ.get("MASK"):
        # regenerate only where the mask is white; black (the product) is never changed by the model
        g["mload"] = {"class_type": "LoadImage", "inputs": {"image": os.environ["MASK"]}}
        g["mconv"] = {"class_type": "ImageToMask", "inputs": {"image": ["mload", 0], "channel": "red"}}
        g["nmask"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["enc0", 0], "mask": ["mconv", 0]}}
        g["sample"]["inputs"]["latent_image"] = ["nmask", 0]
    return g

if __name__ == "__main__":
    out, seed, ptxt, size, prefix = sys.argv[1:6]
    w, h = map(int, size.split("x"))
    import os
    json.dump(build(int(seed), open(ptxt).read().strip(), w, h, prefix, sys.argv[6:], steps=int(os.environ.get("STEPS", 4)),
                    start=int(os.environ.get("START", 0))), open(out, "w"), indent=1)
    print("written", out)
