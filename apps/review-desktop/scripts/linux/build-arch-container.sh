#!/usr/bin/env bash
# Container entrypoint for build-arch-package.sh. Never run on a user machine.
set -euo pipefail
[[ -n "${WHITEBOARD_CHANNEL:-}" && -n "${WHITEBOARD_VERSION:-}" && -n "${WHITEBOARD_REVISION:-}" && -n "${HOST_UID:-}" && -n "${HOST_GID:-}" ]]
NAME=whiteboard
if [[ "$WHITEBOARD_CHANNEL" == preview ]]; then NAME=whiteboard-preview; fi
# pacman's download sandbox fails in unprivileged Docker containers (observed
# locally under emulation; CI runs natively). Disable pacman's own sandbox
# instead; fail loudly if the setting didn't apply, since a base-image config
# change would otherwise surface as the cryptic error later.
sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
grep -qx DisableSandbox /etc/pacman.conf
# The pinned image's archlinux-keyring can predate keys used to sign current
# packages; refresh it before syncing, or -Syu fails on signature checks.
pacman -Sy --noconfirm archlinux-keyring
pacman -Syu --noconfirm
useradd -m builder
install -d -o builder /build
cp /recipe/PKGBUILD /build/
cp /packages/whiteboard-payload.tar.zst /build/
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
