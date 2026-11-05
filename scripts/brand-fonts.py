"""Builds self-hosted brand fonts (Inter, Onest, Yuyu Short) as subset WOFF2.

Inter — UI and body text, Onest — headings, Yuyu Short — the "Adelie" wordmark only
(Latin-only font: allowed because the name is always written in Latin).

Source: github.com/google/fonts (SIL OFL 1.1). Subset: Latin, Latin-1, Cyrillic incl.
Ukrainian, common punctuation and currency. Output goes to assets/fonts/ and is copied to
apps/site/fonts/ and apps/web/src/fonts/.

Usage (needs fonttools + brotli):
  python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
  /tmp/fontenv/bin/python scripts/brand-fonts.py
"""

import io
import pathlib
import shutil
import urllib.parse
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl"
FONTS = {
    "inter": ("Inter[opsz,wght].ttf", "Inter.woff2"),
    "yuyushort": ("YuyuShort-Regular.ttf", "YuyuShort.woff2"),
    "onest": ("Onest[wght].ttf", "Onest.woff2"),
}
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2010-2027,U+2030-203A,U+2116,U+20AC,U+20B4,"
    "U+2122,U+2190-2193,U+2212,U+2215"
)

out_dir = ROOT / "assets" / "fonts"
out_dir.mkdir(parents=True, exist_ok=True)

for family, (src_name, out_name) in FONTS.items():
    url = f"{BASE}/{family}/{urllib.parse.quote(src_name)}"
    data = urllib.request.urlopen(url, timeout=60).read()
    font = TTFont(io.BytesIO(data))
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(out_dir / out_name)
    licence = urllib.request.urlopen(f"{BASE}/{family}/OFL.txt", timeout=60).read()
    (out_dir / f"OFL-{family}.txt").write_bytes(licence)
    print(f"{out_name}: {(out_dir / out_name).stat().st_size // 1024} KB")

for target in [ROOT / "apps" / "site" / "fonts", ROOT / "apps" / "web" / "src" / "fonts"]:
    target.mkdir(parents=True, exist_ok=True)
    for f in out_dir.iterdir():
        shutil.copy2(f, target / f.name)
print("copied to apps/site/fonts and apps/web/src/fonts")
