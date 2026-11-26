"""FLUX 3 Image Klein (5.6B, FLUX Kommunity License: commercial outputs allowed under US$5M revenue) edit workflow for
ComfyUI (API format) - a drop-in twin of wf_klein.py: same CLI, same START (begin from the MAIN image's latent, skip the
first START of STEPS) and MASK (latent noise mask) semantics. Wiring follows BFL's flux3_klein_int8_mi2i workflow:
Qwen3-VL-4B encoder, ModelSamplingFlux with shift log(16), ReferenceMultiLatent, euler/simple, cfg 1, 16 steps.
Usage: wf_flux3.py out.json seed prompt.txt WxH prefix main.png [ref2.png ...]   env: STEPS 16, START 0, MASK, REF_MP 1.0, NO_MAIN_REF"""
import json, math, os, sys

UNET = os.environ.get("FLUX3_UNET", "flux3-image-klein-int8-convrot.safetensors")
TE = os.environ.get("FLUX3_TE", "qwen3vl_4b_int8_convrot.safetensors")

def build(seed, prompt, w, h, prefix, images, steps=16, start=0):
    g = {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": TE, "type": "flux3", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "msf": {"class_type": "ModelSamplingFlux", "inputs": {"model": ["unet", 0], "max_shift": math.log(16), "base_shift": math.log(16),
                                                              "width": 1024, "height": 1024}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["clip", 0]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["clip", 0]}},
    }
    ref = {"positive": ["pos", 0], "negative": ["neg", 0], "vae": ["vae", 0],
           "resolution": "resize", "resolution.megapixels": float(os.environ.get("REF_MP", 1.0))}
    for i, img in enumerate(images):
        g[f"load{i}"] = {"class_type": "LoadImage", "inputs": {"image": img}}
        if not (i == 0 and os.environ.get("NO_MAIN_REF")):     # detail pass: the main image only as the start latent,
            ref[f"images.image{i}"] = [f"load{i}", 0]          # else the model copies the wrong object back
    g["ref"] = {"class_type": "ReferenceMultiLatent", "inputs": ref}
    # the sampled latent: the main image at the output size (START > 0) or an empty one
    g["scale"] = {"class_type": "ImageScale", "inputs": {"image": ["load0", 0], "upscale_method": "lanczos", "width": w, "height": h, "crop": "center"}}
    g["enc"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["vae", 0]}}
    g["empty"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}}
    lat = ["enc", 0] if start else ["empty", 0]
    if start and os.environ.get("MASK"):
        g["mload"] = {"class_type": "LoadImage", "inputs": {"image": os.environ["MASK"]}}
        g["mconv"] = {"class_type": "ImageToMask", "inputs": {"image": ["mload", 0], "channel": "red"}}
        g["nmask"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["enc", 0], "mask": ["mconv", 0]}}
        lat = ["nmask", 0]
    g["sample"] = {"class_type": "KSamplerAdvanced", "inputs": {
        "model": ["msf", 0], "positive": ["ref", 0], "negative": ["ref", 1], "latent_image": lat,
        "add_noise": "enable", "noise_seed": seed, "steps": steps, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
        "start_at_step": start, "end_at_step": 10000, "return_with_leftover_noise": "disable"}}
    g["decode"] = {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]}}
    g["save"] = {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}}
    return g

if __name__ == "__main__":
    out, seed, ptxt, size, prefix = sys.argv[1:6]
    w, h = map(int, size.split("x"))
    json.dump(build(int(seed), open(ptxt).read().strip(), w, h, prefix, sys.argv[6:], steps=int(os.environ.get("STEPS", 16)),
                    start=int(os.environ.get("START", 0))), open(out, "w"), indent=1)
    print("written", out)
