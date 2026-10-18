#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
BLENDER="${BLENDER:-/opt/homebrew/bin/blender}"
USDZIP="${USDZIP:-/usr/bin/usdzip}"
OUTPUT="${1:-$ROOT/App/Assets/Ember/Ember.usdz}"
PREVIEW="${2:-}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/shipcat-ember.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

if [[ ! -x "$BLENDER" ]]; then
  echo "Blender executable not found: $BLENDER" >&2
  exit 1
fi
if [[ ! -x "$USDZIP" ]]; then
  echo "Apple USD package tool not found: $USDZIP" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUTPUT")"
BLENDER_ARGS=("$BLENDER" -b --python "$ROOT/scripts/build_ember.py" -- "$TEMP_DIR/Ember.usdc")
if [[ -n "$PREVIEW" ]]; then
  mkdir -p "$PREVIEW"
  BLENDER_ARGS+=("$PREVIEW")
fi
"${BLENDER_ARGS[@]}"
"$USDZIP" --checkCompliance "$OUTPUT" "$TEMP_DIR/Ember.usdc"
"$USDZIP" --list - "$OUTPUT" >/dev/null
printf 'EMBER_USDZ %s %s bytes\n' "$OUTPUT" "$(stat -f%z "$OUTPUT")"
