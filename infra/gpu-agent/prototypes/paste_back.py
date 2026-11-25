"""Final blend: harmonised pass only inside the floor strip (mask), then the ORIGINAL product pixels pasted back over it."""
import json, sys
from PIL import Image
composite, harmonised, mask, cut_scaled, placement, out = sys.argv[1:7]
base = Image.open(composite).convert("RGB"); har = Image.open(harmonised).convert("RGB")
m = Image.open(mask).convert("L")
s = Image.composite(har, base, m)
c = Image.open(cut_scaled).convert("RGBA"); x, y = json.load(open(placement))["pos"]
s.paste(c, (x, y), c)
s.save(out); print("saved", out)
