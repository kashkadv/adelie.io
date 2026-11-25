#!/bin/bash
# Owner's comparison (2026-11-25), flower rug, klein 9B, seed 904:
#   a) off-white placeholder mat: rug fitted to the model's mat, model re-renders the rug, sharp floor back
#   b) bare floor (no placeholder): rug placed by the computed camera, nothing to repaint, model re-renders the rug
set -e
CUI=~/ComfyUI; W=$CUI/work/t3eye; K=$W/k9; P="$(cd "$(dirname "$0")" && pwd)"; PY=$CUI/venv/bin/python; O=$CUI/output/klein_4b_vs_9b
free() { curl -s -X POST localhost:8188/free -H 'Content-Type: application/json' -d '{"unload_models":true,"free_memory":true}' >/dev/null; }
klein() { # seed prompt prefix main [ref]  (env MASK, START)
  KLEIN=9b STEPS=8 $PY -I "$P/wf_klein.py" $K/ab_$3.json $1 "$2" 832x1248 k9/$3 "${@:4}" >/dev/null
  $PY -I "$P/comfy_run.py" $K/ab_$3.json | tail -1; }
prep() { # alpha.png placed.png tag -> input mask + 1 MP composite + rgba outline
  $PY -I - "$1" "$2" "$3" <<'EOF'
import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
al, pl, tag = sys.argv[1:4]; I = "/home/kashka/ComfyUI/input/"
A = Image.open(al); a = np.asarray(A.resize((832, 1248))) > 128
Image.fromarray((ndi.binary_dilation(a, iterations=14) * 255).astype(np.uint8)).convert("RGB").save(I + f"ab_{tag}_mask.png")
Image.open(pl).resize((832, 1248), Image.LANCZOS).save(I + f"ab_{tag}_placed.png")
c = Image.new("RGBA", A.size, (0, 0, 0, 0)); c.putalpha(A); c.save(al.replace(".png", "_rgba.png"))
EOF
}
finish() { # tag placed.png alpha.png out
  MASK=ab_$1_mask.png START=2 klein 904 "$P/recipes/prompt_rug_rerender_v1.txt" $1_rr ab_$1_placed.png t3eye_rugref.png
  free; $PY -I "$P/scene_up2x.py" $CUI/output/k9/$1_rr_00001_.png $K/$1_rr_x2.png | tail -1
  $PY -I "$P/rerender_finish.py" $2 $K/$1_rr_x2.png ${3%.png}_rgba.png $4; }

# a) white mat - placement already done (white_placed.png, white_alpha.png)
prep $K/white_alpha.png $K/white_placed.png a
finish a $K/white_placed.png $K/white_alpha.png $O/25a_white_mat_final.png

# b) bare floor
ROT=90 ELEV=35 SIZE=150x200 ROOM_CM=380 CY=0.72 SIDE_TABLE=right ARMCHAIR=left SLAB=0 $PY -I "$P/scene_proxy.py" $W/cut_c.png $W/main_bare.png >/dev/null
cp $W/main_bare.png $CUI/input/t3eye_proxy_bare.png
START=1 klein 904 "$P/recipes/prompt_living_bare_v1.txt" bare_room t3eye_proxy_bare.png
free; $PY -I "$P/scene_up2x.py" $CUI/output/k9/bare_room_00001_.png $K/bare_x2.png | tail -1
FIT=0 FILL=none ALPHA_OUT=$K/bare_alpha.png $PY -I "$P/place_on_placeholder.py" $K/bare_x2.png $W/cut_flat.png $K/bare_placed.png | grep -iE "occlu|gain"
prep $K/bare_alpha.png $K/bare_placed.png b
finish b $K/bare_placed.png $K/bare_alpha.png $O/25b_bare_floor_final.png
cp $CUI/output/k9/bare_room_00001_.png $O/25b_bare_floor_room.png
mv $CUI/output/k9/*.png $K/raw/ && rmdir $CUI/output/k9
echo done
