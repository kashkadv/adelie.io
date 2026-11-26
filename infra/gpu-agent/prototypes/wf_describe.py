"""Describe reference images in words for the scene prompt (owner, 2026-11-26: a picture alone is a weak hint; the image
model follows concrete words far better). BFL's FLUX 3 Klein prompt upsampler (Qwen3.5-9B vision-language, Apache 2.0,
w4a8) looks at the references and writes the concrete style: surfaces, materials, furniture, decor, palette, light.
Usage: wf_describe.py out.json ref1.png [ref2.png ref3.png]      (then comfy_run.py; the text is in PreviewAny's output)"""
import json, os, sys

PUP = os.environ.get("PUP", "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors")
SYSTEM = (
    "You describe the interior design style of reference photographs for an image generator. Write ONE paragraph of "
    "40 to 80 words, only concrete visible things: wall surfaces and their texture, floor, ceiling, furniture materials "
    "and shapes, textiles, decor objects, plants, colour palette, light. Use concrete nouns and materials, no "
    "adjectives like beautiful, luxury or elegant. Do not describe the camera, the layout, people, rugs or carpets. "
    "If there are several photos, describe the style they share."
)
ASK = "Describe the interior style of the reference photo(s) as instructed. Output only the paragraph."


def build(images):
    g = {"clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": PUP, "type": "flux3", "device": "default"}}}
    for i, img in enumerate(images):
        g[f"load{i}"] = {"class_type": "LoadImage", "inputs": {"image": img}}
    if len(images) == 1:
        image = ["load0", 0]
    else:
        g["batch"] = {"class_type": "BatchImagesNode",
                      "inputs": {f"images.image{i}": [f"load{i}", 0] for i in range(len(images))}}
        image = ["batch", 0]
    g["gen"] = {"class_type": "TextGenerate", "inputs": {
        "clip": ["clip", 0], "prompt": ASK, "image": image, "max_length": 260, "sampling_mode": "off",
        "thinking": False, "use_default_template": True, "mtp": "off", "system_prompt": SYSTEM}}
    g["show"] = {"class_type": "PreviewAny", "inputs": {"source": ["gen", 0]}}
    return g


if __name__ == "__main__":
    json.dump(build(sys.argv[2:]), open(sys.argv[1], "w"), indent=1)
    print("written", sys.argv[1])
