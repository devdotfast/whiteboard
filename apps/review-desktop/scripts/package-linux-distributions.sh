#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CHECKOUT="$APP_DIR/code-oss"
DIST="$APP_DIR/dist/linux"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'Linux packages must be built on Linux x86_64' >&2; exit 1;
}

FORMAT="${1:-all}"
case "$FORMAT" in rpm|deb|arch|nixos|all) ;; *) echo "Unknown package format: $FORMAT" >&2; exit 2 ;; esac
node "$APP_DIR/scripts/stage-review-runtime.mjs" --verify --packaged-root "$APP_DIR/VSCode-linux-x64"
mkdir -p "$DIST"
node --experimental-strip-types "$APP_DIR/scripts/package-linux-distributions.mjs" "$FORMAT"
if [[ "$FORMAT" == rpm || "$FORMAT" == all ]]; then
  cp "$CHECKOUT"/.build/linux/rpm/x86_64/whiteboard*.x86_64.rpm "$DIST/"
fi
if [[ "$FORMAT" == deb || "$FORMAT" == all ]]; then
  cp "$CHECKOUT"/.build/linux/deb/amd64/whiteboard*_amd64.deb "$DIST/"
fi
if [[ "$FORMAT" == arch || "$FORMAT" == all ]]; then
  tar --zstd --owner=0 --group=0 -cf "$DIST/whiteboard-payload.tar.zst" -C "$CHECKOUT/.build/linux/arch/x86_64/package" usr
  CHANNEL=$(node -p "require('$APP_DIR/VSCode-linux-x64/resources/app/product.json').quality")
  VERSION=$(node -p "require('$APP_DIR/package.json').version.replace('-preview.', '~preview.')")
  bash "$APP_DIR/scripts/linux/build-arch-package.sh" "$DIST" "$CHANNEL" "$VERSION" "${REVIEW_LINUX_PACKAGE_REVISION:-1}"
  rm "$DIST/whiteboard-payload.tar.zst"
fi
if [[ "$FORMAT" == nixos || "$FORMAT" == all ]]; then
  STAGING="$CHECKOUT/.build/linux/nixos/x86_64/package"
  NAME=$(node -p "require('$STAGING/release.json').packageName")
  VERSION=$(node -p "require('$STAGING/release.json').version")
  tar --sort=name --mtime=@0 --owner=0 --group=0 -czf \
    "$DIST/$NAME-$VERSION-${REVIEW_LINUX_PACKAGE_REVISION:-1}-x86_64.nix.tar.gz" \
    -C "$(dirname "$STAGING")" package
fi
