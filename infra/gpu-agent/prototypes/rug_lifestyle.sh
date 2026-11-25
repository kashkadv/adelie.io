#!/bin/bash
# One rug -> one lifestyle frame, the recipe agreed with the owner on 2026-11-25/26 (all local, no cloud AI):
#   1. cut-out of the main photo (GroundingDINO+SAM2, BiRefNet matting, edge clean-up)
#   2. the rug at its real size, seen from standing height (rectify_place.py)
#   3. block mock-up of the room in real cm WITHOUT a placeholder (bare floor), armchair at 90 deg, side table
#   4. klein room from the mock-up (short anchored prompt)
#   5. the rug placed on the bare floor, its sides turned to the floorboards' vanishing point
#   6. klein re-renders only the rug (volume, light; real thickness) with the photo as reference
#   7. sharp floor back, original pattern + fibres with the model's light, neutral grade, no clipping, tighter crop
# Usage: rug_lifestyle.sh <name> <folder under input/gushka> <main photo> <W>x<H cm> <thickness mm> [seed] [ref photo]
# env: KLEIN (4b|9b, default 9b - 9B is non-commercial: comparison only), ROT 90, ELEV 35, ROOM_CM 380, CY 0.72,
#      FRINGE_CM (fringe on the short ends, not part of the size; drawn by the model). Not given: fringe_check.py looks
#      for a fringe on every photo of the product and sets it (length from the main photo, else 5 cm).
set -e
NAME=$1; FOLDER=$2; MAIN=$3; SIZE=$4; THICK=$5; SEED=${6:-904}; REF=$7
CUI=~/ComfyUI; P="$(cd "$(dirname "$0")" && pwd)"; PY=$CUI/venv/bin/python; PYM=~/birefnet-test/bin/python
WK=$CUI/work/$NAME; mkdir -p $WK; OUTD=$CUI/output/$NAME; mkdir -p $OUTD
export KLEIN=${KLEIN:-9b}; GEO="ROT=${ROT:-90} ELEV=${ELEV:-35} SIZE=$SIZE ROOM_CM=${ROOM_CM:-380} CY=${CY:-0.72}"
free() { curl -s -X POST localhost:8188/free -H 'Content-Type: application/json' -d '{"unload_models":true,"free_memory":true}' >/dev/null; }
klein() { # seed prompt prefix main [refs...]   (env MASK, START)
  STEPS=8 $PY -I "$P/wf_klein.py" $WK/$3.json $1 "$2" 832x1248 $NAME/$3 "${@:4}" >/dev/null
  $PY -I "$P/comfy_run.py" $WK/$3.json | tail -1; }

echo "== 1. cut-out"; free
if [ ! -f $WK/cut.png ]; then
  $PY -I -c "from PIL import Image; Image.open('$CUI/input/gushka/$FOLDER/$MAIN').convert('RGB').save('$CUI/input/gushka/$NAME.jpg', quality=97)"
  mkdir -p $CUI/output/etap0
  (cd "$P" && $PY -I sam_stage1.py "$NAME=a rug." | tail -1)
  (cd "$P" && MASKS=$CUI/output/etap0 CORE=10 TAG=_solid $PYM -I pipeline_full.py $NAME | tail -1)
  mv $CUI/output/etap0/${NAME}_* $WK/
  $PY -I -c "from PIL import Image; Image.open('$CUI/input/gushka/$NAME.jpg').save('$WK/photo.png')"
  $PY -I "$P/dehaze_alpha.py" $WK/${NAME}_solid_cutout.png $WK/cut_dh.png | tail -1
  $PY -I "$P/decontaminate_edge.py" $WK/photo.png $WK/cut_dh.png $WK/cut.png | tail -1
fi
if [ -z "$FRINGE_CM" ]; then                       # fringe: product field if given, else found on the product's photos
  echo "== fringe check on all photos"
  FC=$($PY -I "$P/fringe_check.py" "$CUI/input/gushka/$FOLDER" "$MAIN" $WK/cut.png "${SIZE#*x}" 2>/dev/null | tee $WK/fringe.txt | tail -1)
  grep -v "^FRINGE" $WK/fringe.txt; echo "   $FC"
  if [[ $FC == "FRINGE yes"* ]]; then FRINGE_CM=$(echo "$FC" | awk '{print $6}'); [ "$FRINGE_CM" = "-" ] && FRINGE_CM=5; else FRINGE_CM=0; fi
  echo "   -> fringe drawn by the model: ${FRINGE_CM} cm"
fi
echo "== 2. woven body only (fringe is not in the size; FRINGE_CM is drawn by the model)"
$PY -I - $WK/cut.png $WK/cut_body.png <<'EOF2'
import sys, numpy as np
from PIL import Image
c = Image.open(sys.argv[1]).convert("RGBA"); a = np.asarray(c.split()[3]) / 255.
r = np.nonzero(a.sum(1) > 0.9 * a.sum(1).max())[0]; k = np.nonzero(a.sum(0) > 0.9 * a.sum(0).max())[0]
m = np.zeros_like(a); m[r.min():r.max() + 1, k.min():k.max() + 1] = 1
A = (a * m * 255).astype(np.uint8); c.putalpha(Image.fromarray(A)); c.save(sys.argv[2])
print("body %dx%d px of %dx%d" % (np.ptp(k) + 1, np.ptp(r) + 1, *c.size))
EOF2
echo "== 3. real size, standing height, bare-floor mock-up"
env $GEO $PY -I "$P/rectify_place.py" $WK/photo.png $WK/cut_body.png $WK/photo_c.png $WK/cut_flat.png | tail -1
env $GEO SIDE_TABLE=right ARMCHAIR=left SLAB=0 $PY -I "$P/scene_proxy.py" $WK/cut_flat.png $WK/proxy.png | tail -1
cp $WK/proxy.png $CUI/input/${NAME}_proxy.png
# rug reference for the re-render: the cut-out on white (+ an optional close-up of the texture)
$PY -I - "$WK/cut_flat.png" "$CUI/input/${NAME}_ref.png" <<'EOF'
import sys
from PIL import Image
c = Image.open(sys.argv[1]).convert("RGBA"); c = c.crop(c.getbbox())
bg = Image.new("RGBA", c.size, (255, 255, 255, 255)); bg.alpha_composite(c); bg.convert("RGB").save(sys.argv[2])
EOF
REFS="${NAME}_ref.png"
if [ -n "$REF" ]; then $PY -I -c "from PIL import Image; Image.open('$CUI/input/gushka/$FOLDER/$REF').convert('RGB').save('$CUI/input/${NAME}_tex.png')"; REFS="$REFS ${NAME}_tex.png"; fi

echo "== 4. room"
sed "s/150 x 200/${SIZE/x/ x }/" "$P/recipes/prompt_living_bare_v1.txt" > $WK/p_room.txt
START=1 klein $SEED $WK/p_room.txt room ${NAME}_proxy.png
free; $PY -I "$P/scene_up2x.py" $CUI/output/$NAME/room_00001_.png $WK/room_x2.png | tail -1

echo "== 5. rug on the floor, boards' perspective"
FIT=vp FILL=none CONTACT=0.12 ALPHA_OUT=$WK/alpha.png $PY -I "$P/place_on_placeholder.py" $WK/room_x2.png $WK/cut_flat.png $WK/placed.png | grep -iE "vanish|planned"
$PY -I - "$WK" "$CUI/input" "$NAME" "${FRINGE_CM:-0}" "${SIZE#*x}" <<'EOF'
import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
wk, inp, name = sys.argv[1:4]
A = Image.open(wk + "/alpha.png"); a = np.asarray(A.resize((832, 1248))) > 128
m = ndi.binary_dilation(a, iterations=14)
fr = float(sys.argv[4]) if len(sys.argv) > 4 else 0
if fr > 0:                                                  # room for the fringe the model draws on the short ends
    xs = np.nonzero(a.any(0))[0]; k = max(3, int(round((np.ptp(xs) + 1) * fr / float(sys.argv[5]))))
    m |= ndi.binary_dilation(a, structure=np.ones((1, 2 * k + 1)))
Image.fromarray((m * 255).astype(np.uint8)).convert("RGB").save(f"{inp}/{name}_mask.png")
Image.open(wk + "/placed.png").resize((832, 1248), Image.LANCZOS).save(f"{inp}/{name}_placed.png")
c = Image.new("RGBA", A.size, (0, 0, 0, 0)); c.putalpha(A); c.save(wk + "/alpha_rgba.png")
EOF

echo "== 6. re-render the rug"
sed "s/{THICK}/$THICK/" "$P/recipes/prompt_rug_rerender_v2.txt" > $WK/p_rr.txt
if [ "${FRINGE_CM:-0}" != "0" ]; then
  sed -i "s/Nothing lies on the rug/Both short ends of the rug have a soft natural white wool fringe about ${FRINGE_CM} cm long lying loosely on the floor. Nothing lies on the rug/" $WK/p_rr.txt
fi
MASK=${NAME}_mask.png START=2 klein $SEED $WK/p_rr.txt rug ${NAME}_placed.png $REFS
free; $PY -I "$P/scene_up2x.py" $CUI/output/$NAME/rug_00001_.png $WK/rug_x2.png | tail -1

echo "== 7. finish"
GMIN=0.85 $PY -I "$P/rerender_finish.py" $WK/placed.png $WK/rug_x2.png $WK/alpha_rgba.png $WK/finished.png
ORIG=$WK/cut_flat.png $PY -I "$P/final_look.py" $WK/finished.png $WK/placed.png $WK/alpha.png $OUTD/${NAME}_${SEED}.png | grep -v "^pattern match"
mkdir -p $WK/raw; mv $CUI/output/$NAME/*_0000*.png $WK/raw/ 2>/dev/null || true
cp $WK/raw/room_00001_.png $OUTD/${NAME}_${SEED}_room.png
echo "done: $OUTD/${NAME}_${SEED}.png"
