"""Builds the ComfyUI API workflow files: (1) a text-to-image scene with SDXL, (2) a low-denoise image-to-image pass that harmonises a composite."""
import json, sys

CKPT = "sd_xl_base_1.0.safetensors"
POS_DEFAULT = ("interior photography, minimalist scandinavian living room, light oak wooden floor in the foreground with a large empty free area of floor, "
       "soft diffused daylight from a window on the left, warm white walls, a linen sofa far in the background slightly out of focus, "
       "shallow depth of field, photorealistic, natural light, 35mm lens, camera at low height looking straight ahead")
POS_LOW = ("photograph taken from a very low camera height just above the floor, looking along the floor with a shallow grazing angle, "
           "large empty area of smooth grey microcement floor in the foreground, soft neutral studio-like daylight, dark modern interior, "
           "a sofa on black legs far in the background out of focus, muted neutral colours, photorealistic, 50mm lens, shallow depth of field")
import os
POS = POS_LOW if os.environ.get("SCENE") == "low" else POS_DEFAULT
NEG = "rug, carpet, mat, furniture in the foreground, people, text, watermark, logo, clutter, cartoon, painting, oversaturated"

def txt2img(seed, prefix, w=832, h=1216):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0],
              "seed": seed, "steps": 30, "cfg": 6.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }

def img2img(image_name, seed, prefix, denoise=0.3):
    wf = txt2img(seed, prefix)
    wf["4"] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
    wf["8"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["4", 0], "vae": ["1", 2]}}
    wf["5"]["inputs"]["latent_image"] = ["8", 0]; wf["5"]["inputs"]["denoise"] = denoise; wf["5"]["inputs"]["steps"] = 30
    return wf

if __name__ == "__main__":
    kind, out = sys.argv[1], sys.argv[2]
    wf = txt2img(int(sys.argv[3]), "scene/scene") if kind == "txt2img" else img2img(sys.argv[3], int(sys.argv[4]), "scene/harmonised", float(sys.argv[5]))
    json.dump(wf, open(out, "w"), indent=1); print("written", out)
