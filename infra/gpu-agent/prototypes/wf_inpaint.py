"""SDXL: keep the product where it is in its own photo and repaint everything around it (background replacement)."""
import json, sys
CKPT = "sd_xl_base_1.0.safetensors"
POS = ("close-up interior photograph, low camera near the floor, a rug lying flat on a light oak wooden floor, "
       "soft natural daylight from a window on the left, soft contact shadow under the rug, blurred cozy living room in the background, photorealistic, 50mm")
NEG = "second rug, carpet pattern, people, text, watermark, logo, clutter, cartoon, painting, oversaturated, floating"
def wf(image, mask, seed, prefix):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "4": {"class_type": "LoadImage", "inputs": {"image": image}},
        "9": {"class_type": "LoadImageMask", "inputs": {"image": mask, "channel": "red"}},
        "8": {"class_type": "VAEEncodeForInpaint", "inputs": {"pixels": ["4", 0], "vae": ["1", 2], "mask": ["9", 0], "grow_mask_by": 8}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["8", 0],
              "seed": seed, "steps": 35, "cfg": 6.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }
if __name__ == "__main__":
    json.dump(wf(sys.argv[2], sys.argv[3], int(sys.argv[4]), "scene/inpaint"), open(sys.argv[1], "w"), indent=1)
