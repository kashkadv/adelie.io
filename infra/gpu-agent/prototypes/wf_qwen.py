"""Qwen-Image-Edit-2511 (Apache 2.0, 20B, GGUF Q4_K_M + Lightning LoRA) edit workflow for ComfyUI (API format) - a drop-in
twin of wf_klein.py for the klein / Qwen comparison: the same CLI and the same START semantics (begin from the MAIN image's
own latent and skip the first START steps of STEPS). Up to 3 images (image 1 = main). Needs custom_nodes/ComfyUI-GGUF.
Usage: wf_qwen.py out.json seed prompt.txt WxH prefix main.png [ref2.png ref3.png]   env: STEPS 8, START 0, SHIFT 3.1"""
import json, os, sys

UNET = os.environ.get("QWEN_UNET", "qwen-image-edit-2511-Q4_K_M.gguf")
LORA = os.environ.get("QWEN_LORA", "Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors")

def build(seed, prompt, w, h, prefix, images, steps=8, start=0):
    g = {
        "unet": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": UNET}},
        "lora": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["unet", 0], "lora_name": LORA, "strength_model": 1.0}},
        "shift": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["lora", 0], "shift": float(os.environ.get("SHIFT", 3.1))}},
        "cfgn": {"class_type": "CFGNorm", "inputs": {"model": ["shift", 0], "strength": 1.0}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
    }
    enc = {}
    for i, img in enumerate(images[:3]):
        g[f"load{i}"] = {"class_type": "LoadImage", "inputs": {"image": img}}
        enc[f"image{i + 1}"] = [f"load{i}", 0]
    for k, txt in (("pos", prompt), ("neg", "")):
        g[k + "0"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["clip", 0], "prompt": txt, "vae": ["vae", 0], **enc}}
        g[k] = {"class_type": "FluxKontextMultiReferenceLatentMethod",
                "inputs": {"conditioning": [k + "0", 0], "reference_latents_method": "index_timestep_zero"}}
    # the sampled latent: the main image itself at the output size (START > 0) or an empty one
    g["scale"] = {"class_type": "ImageScale", "inputs": {"image": ["load0", 0], "upscale_method": "lanczos", "width": w, "height": h, "crop": "center"}}
    g["enc"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["vae", 0]}}
    g["empty"] = {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}}
    g["sample"] = {"class_type": "KSamplerAdvanced", "inputs": {
        "model": ["cfgn", 0], "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["enc", 0] if start else ["empty", 0],
        "add_noise": "enable", "noise_seed": seed, "steps": steps, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
        "start_at_step": start, "end_at_step": 10000, "return_with_leftover_noise": "disable"}}
    g["decode"] = {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]}}
    g["save"] = {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}}
    return g

if __name__ == "__main__":
    out, seed, ptxt, size, prefix = sys.argv[1:6]
    w, h = map(int, size.split("x"))
    json.dump(build(int(seed), open(ptxt).read().strip(), w, h, prefix, sys.argv[6:], steps=int(os.environ.get("STEPS", 8)),
                    start=int(os.environ.get("START", 0))), open(out, "w"), indent=1)
    print("written", out)
