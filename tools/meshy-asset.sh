#!/bin/bash
# meshy-asset.sh — make one 3D asset with Meshy AI and put it in a content folder.
#
#   tools/meshy-asset.sh <cars|props> <id> <triangles> "<image prompt>"
#
# Steps: reference image (9 credits) -> 3D model with clean "smart" topology and
# 2K PBR textures (15 credits) -> public/content/<kind>/<id>/model.glb
# Needs the Meshy CLI, signed in:  npm i -g meshy-cli@0.8 && meshy auth login --device
# Safe to re-run: finished steps are remembered in tools/meshy-jobs/<id>.env
set -euo pipefail
KIND="$1"; ID="$2"; TRIS="$3"; PROMPT="$4"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOBS="$ROOT/tools/meshy-jobs"; OUT="$ROOT/public/content/$KIND/$ID"
mkdir -p "$JOBS/$ID" "$OUT"
STATE="$JOBS/$ID.env"; touch "$STATE"; source "$STATE"
M="meshy --format json --no-update-check"
field() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

if [ -z "${IMAGE_TASK:-}" ]; then
  IMAGE_TASK=$($M text-to-image create --ai-model gpt-image-2-5-flare --prompt "$PROMPT" --aspect-ratio 1:1 --async | field "d['result']['task_id']")
  echo "IMAGE_TASK=$IMAGE_TASK" >> "$STATE"
fi
$M text-to-image wait "$IMAGE_TASK" --timeout 900 > /dev/null
if [ ! -f "$OUT/reference.png" ]; then
  $M download --resource text-to-image --task-id "$IMAGE_TASK" --kind image --output-dir "$JOBS/$ID" --workspace "$ROOT" > /dev/null
  cp "$JOBS/$ID/image_0.png" "$OUT/reference.png"
fi
if [ -z "${MODEL_TASK:-}" ]; then
  MODEL_TASK=$($M image-to-3d create --input-task-id "$IMAGE_TASK" --model-type smart-topology --target-polycount "$TRIS" \
    --should-texture true --texture-model meshy-7 --enable-pbr true --texture-resolution 2k --target-formats glb --async | field "d['result']['task_id']")
  echo "MODEL_TASK=$MODEL_TASK" >> "$STATE"
fi
$M image-to-3d wait "$MODEL_TASK" --timeout 1800 > /dev/null
rm -rf "$JOBS/$ID/out"
$M image-to-3d get "$MODEL_TASK" -o "$JOBS/$ID/out" --workspace "$ROOT" > /dev/null
cp "$JOBS/$ID/out/model.glb" "$OUT/model.glb"
cp "$JOBS/$ID/out/thumbnail.png" "$OUT/thumbnail.png" 2>/dev/null || true
echo "DONE $KIND/$ID"
