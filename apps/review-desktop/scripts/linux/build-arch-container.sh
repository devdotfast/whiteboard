#!/usr/bin/env bash
# Container entrypoint for build-arch-package.sh. Never run on a user machine.
set -euo pipefail
[[ -n "${WHITEBOARD_CHANNEL:-}" && -n "${WHITEBOARD_VERSION:-}" && -n "${WHITEBOARD_REVISION:-}" && -n "${HOST_UID:-}" ]]
NAME=whiteboard
if [[ "$WHITEBOARD_CHANNEL" == preview ]]; then NAME=whiteboard-preview; fi
# pacman's per-download sandbox calls syscalls this emulated linux/amd64
# kernel rejects with EINVAL, even with Docker's seccomp filter off
# (`--security-opt seccomp=unconfined` alone does not fix it; verified). Disable
# pacman's own sandbox instead; fail loudly if the setting didn't apply, since a
# base-image config change would otherwise surface as the cryptic error later.
sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
grep -qx DisableSandbox /etc/pacman.conf
pacman -Syu --noconfirm --needed rpm-tools
useradd -m builder
install -d -o builder /build
cp /recipe/PKGBUILD /build/
cp "/packages/$NAME-$WHITEBOARD_VERSION-$WHITEBOARD_REVISION.x86_64.rpm" /build/
chown -R builder /build
# makepkg refuses to run as root. --nodeps: runtime depends are not needed to repackage.
runuser -u builder -- env -C /build \
  WHITEBOARD_CHANNEL="$WHITEBOARD_CHANNEL" WHITEBOARD_VERSION="$WHITEBOARD_VERSION" WHITEBOARD_REVISION="$WHITEBOARD_REVISION" \
  PACKAGER='dev.fast <support@dev.fast>' makepkg --nodeps --noconfirm
PACKAGE="$NAME-$WHITEBOARD_VERSION-$WHITEBOARD_REVISION-x86_64.pkg.tar.zst"
test -f "/build/$PACKAGE"
# Unsigned here; build-linux-repository.py signs on the host, so no key enters the container.
repo-add "/build/$NAME.db.tar.gz" "/build/$PACKAGE"
install -o "$HOST_UID" -g "$HOST_GID" -m 0644 \
  "/build/$PACKAGE" "/build/$NAME.db.tar.gz" "/build/$NAME.files.tar.gz" /packages/
