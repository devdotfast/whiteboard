#!/usr/bin/env bash
# Build the pacman package and repository databases from the shared install tree.
set -euo pipefail
PACKAGES="$(cd "${1:?usage: build-arch-package.sh packages-dir stable|preview package-version revision}" && pwd -P)"
CHANNEL="${2:?}" VERSION="${3:?}" REVISION="${4:?}"
case "$CHANNEL" in stable|preview) ;; *) echo "Unknown channel: $CHANNEL" >&2; exit 2 ;; esac
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCH_IMAGE='archlinux:base-devel@sha256:8745817f349ed24373341ddb92776209eeec3f0364ea48f7f645ac5800d30a50'
docker run --rm --platform linux/amd64 \
  -v "$PACKAGES:/packages" -v "$SCRIPT_DIR/arch:/recipe:ro" -v "$SCRIPT_DIR:/test:ro" \
  -e WHITEBOARD_CHANNEL="$CHANNEL" -e WHITEBOARD_VERSION="$VERSION" -e WHITEBOARD_REVISION="$REVISION" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  "$ARCH_IMAGE" bash /test/build-arch-container.sh
