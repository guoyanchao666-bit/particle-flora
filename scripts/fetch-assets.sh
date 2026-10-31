#!/usr/bin/env bash
# 下载两个版本共用的静态依赖与手势模型。GitHub Pages 构建和本地首次运行都使用此脚本。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

THREE_BASE="https://unpkg.com/three@0.180.0/build"
MEDIAPIPE_BASE="https://unpkg.com/@mediapipe/tasks-vision@1.2.0"
GSAP_BASE="https://unpkg.com/gsap@3.15.0/dist"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

mkdir -p vendor/three vendor/mediapipe/wasm vendor/gsap models

download() {
  local url="$1"
  local dest="$2"
  if [ -s "$dest" ]; then
    echo "exists  $dest"
    return
  fi
  echo "fetch   $dest"
  curl -fL --retry 4 --retry-delay 2 --connect-timeout 20 "$url" -o "$dest"
}

download "$THREE_BASE/three.module.js" vendor/three/three.module.js
download "$THREE_BASE/three.core.js" vendor/three/three.core.js
download "$MEDIAPIPE_BASE/vision_bundle.mjs" vendor/mediapipe/vision_bundle.mjs

for file in \
  vision_wasm_internal.js \
  vision_wasm_internal.wasm \
  vision_wasm_module_internal.js \
  vision_wasm_module_internal.wasm \
  vision_wasm_nosimd_internal.js \
  vision_wasm_nosimd_internal.wasm; do
  download "$MEDIAPIPE_BASE/wasm/$file" "vendor/mediapipe/wasm/$file"
done

download "$GSAP_BASE/gsap.min.js" vendor/gsap/gsap.min.js
download "$MODEL_URL" models/hand_landmarker.task

echo "assets ready"
