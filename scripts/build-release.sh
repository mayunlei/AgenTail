#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$PROJECT_DIR/package.json').version")"
OUTPUT_DIR="$PROJECT_DIR/release"
TEMP_DIR="$(mktemp -d)"
STAGE_DIR="$TEMP_DIR/agentail"
ASSET_NAME="Agentail-macos-universal.tar.gz"

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

cd "$PROJECT_DIR"
npm run check
npm run app:build

mkdir -p "$STAGE_DIR/dist"
cp -R bin macos public spec src "$STAGE_DIR/"
cp -R dist/Agentail.app "$STAGE_DIR/dist/"
cp LICENSE README.md package.json install.sh "$STAGE_DIR/"
chmod +x "$STAGE_DIR/install.sh" "$STAGE_DIR/bin/agent-session-bridge.mjs"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
COPYFILE_DISABLE=1 tar -czf "$OUTPUT_DIR/$ASSET_NAME" -C "$TEMP_DIR" agentail
(cd "$OUTPUT_DIR" && shasum -a 256 "$ASSET_NAME" > SHA256SUMS.txt)

echo "Built Agentail $VERSION release assets:"
ls -lh "$OUTPUT_DIR/$ASSET_NAME" "$OUTPUT_DIR/SHA256SUMS.txt"
