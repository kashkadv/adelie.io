#!/bin/bash
# klein vs Qwen on the flower rug: stage A rooms (seeds 901-905, START=1) and stage C relight of the same composite (904)
set -e
CUI=~/ComfyUI; W=$CUI/work/t3eye; P="$HOME/My own projects/Adelie/adelie.io/infra/gpu-agent/prototypes"; PY=$CUI/venv/bin/python
Q=$W/qwen; mkdir -p $Q
free() { curl -s -X POST localhost:8188/free -H 'Content-Type: application/json' -d '{"unload_models":true,"free_memory":true}' >/dev/null; }
cp $W/main.png $CUI/input/t3eye_proxy.png
free
for s in 901 902 903 904 905; do
  START=1 STEPS=8 $PY -I "$P/wf_qwen.py" $Q/a$s.json $s $W/pA.txt 832x1248 qwen_t3eye/a$s t3eye_proxy.png >/dev/null
  t0=$(date +%s); $PY -I "$P/comfy_run.py" $Q/a$s.json | tail -1; echo "A $s: $(( $(date +%s)-t0 )) s"
done
free
ls $CUI/output/qwen_t3eye/a*.png
PROXY_SOFA=$(cat $W/main_sofa_box.txt) PROXY_TOL=0.25 ALIGN_MIN=-1 $PY -I "$P/gate_variants.py" $W/cut_c.png $CUI/output/qwen_t3eye/a*.png | tee $Q/gates_A.txt
# stage C: the same composite as klein v4 (b_lama.png)
START=3 STEPS=8 $PY -I "$P/wf_qwen.py" $Q/c904.json 1904 $W/pC2.txt 832x1248 qwen_t3eye/c904 t3eye_v4c904.png >/dev/null
t0=$(date +%s); $PY -I "$P/comfy_run.py" $Q/c904.json | tail -1; echo "C 904: $(( $(date +%s)-t0 )) s"
free
$PY -I "$P/scene_up2x.py" $CUI/output/qwen_t3eye/c904_00001_.png $Q/r904_x2.png | tail -1
$PY -I "$P/relight_back.py" $W/ts_a904_x2.png $W/b_lama.png $Q/r904_x2.png $Q/final_904.png
# numbered klein / Qwen pairs into output (Qwen raw frames go to work)
O=$CUI/output/klein_vs_qwen; mkdir -p $O; i=1
for s in 901 902 903 904 905; do
  cp $W/ts_raw/a${s}_00001_.png $O/$(printf %02d $i)_room_${s}_klein.png
  cp $CUI/output/qwen_t3eye/a${s}_00001_.png $O/$(printf %02d $i)_room_${s}_qwen.png; i=$((i+1))
done
cp $CUI/archive/out_1125_2052/t3eye_v4_904.png $O/$(printf %02d $i)_final_904_klein.png
cp $Q/final_904.png $O/$(printf %02d $i)_final_904_qwen.png
mv $CUI/output/qwen_t3eye $Q/raw
echo done
