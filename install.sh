#!/bin/bash
set -euo pipefail

REPOSITORY="mayunlei/AgenTail"
ASSET="Agentail-macos-universal.tar.gz"
INSTALL_BASE="${AGENTAIL_INSTALL_DIR:-$HOME/.local/share/agentail}"
REQUESTED_VERSION="${AGENTAIL_VERSION:-latest}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Agentail's menu bar installer currently supports macOS only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org/ and retry." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required; found $(node --version)." >&2
  exit 1
fi

if [[ "$REQUESTED_VERSION" == "latest" ]]; then
  DOWNLOAD_BASE="https://github.com/$REPOSITORY/releases/latest/download"
else
  DOWNLOAD_BASE="https://github.com/$REPOSITORY/releases/download/$REQUESTED_VERSION"
fi

TEMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

echo "Downloading Agentail..."
curl --fail --location --silent --show-error "$DOWNLOAD_BASE/$ASSET" --output "$TEMP_DIR/$ASSET"
curl --fail --location --silent --show-error "$DOWNLOAD_BASE/SHA256SUMS.txt" --output "$TEMP_DIR/SHA256SUMS.txt"
(cd "$TEMP_DIR" && shasum -a 256 -c SHA256SUMS.txt)

mkdir -p "$TEMP_DIR/unpacked"
tar -xzf "$TEMP_DIR/$ASSET" -C "$TEMP_DIR/unpacked"
SOURCE_DIR="$TEMP_DIR/unpacked/agentail"
PACKAGE_VERSION="$(node -p "require('$SOURCE_DIR/package.json').version")"
VERSIONS_DIR="$INSTALL_BASE/versions"
TARGET_DIR="$VERSIONS_DIR/$PACKAGE_VERSION"

mkdir -p "$VERSIONS_DIR"
rm -rf "$TARGET_DIR"
mv "$SOURCE_DIR" "$TARGET_DIR"
ln -sfn "$TARGET_DIR" "$INSTALL_BASE/current"

echo "Installing Agentail $PACKAGE_VERSION..."
node "$INSTALL_BASE/current/bin/agent-session-bridge.mjs" app install --prebuilt

echo
echo "Agentail $PACKAGE_VERSION is installed and running."
echo "Open it from the menu bar or ~/Applications/Agentail.app"
