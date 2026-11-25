"""Paste original product pixels (scaled cutout) back over a harmonised scene."""
import json, sys
from PIL import Image
scene, cut_scaled, placement, out = sys.argv[1:5]
s = Image.open(scene).convert("RGB"); c = Image.open(cut_scaled).convert("RGBA")
x, y = json.load(open(placement))["pos"]
s.paste(c, (x, y), c)
s.save(out); print("saved", out)
