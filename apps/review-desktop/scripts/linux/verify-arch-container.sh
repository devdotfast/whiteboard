#!/usr/bin/env bash
# Container entrypoint for verify-repository.sh. Never run on a user machine.
set -euo pipefail
[[ -n "${GENERATION:-}" && -n "${FINGERPRINT:-}" && -n "${PREFIX:-}" && -n "${PACKAGE:-}" && -n "${APP:-}" ]]
REPO=/repo/arch/x86_64
cp -a "/publication/$PREFIX" /repo
# Stand in for the Worker's generation redirect.
cp "/repo/snapshots/$GENERATION/arch/x86_64/$PACKAGE".* "$REPO/"
pacman-key --init
pacman-key --add "/publication/repos/keys/$FINGERPRINT.asc"
pacman-key --lsign-key "$FINGERPRINT"
cat >> /etc/pacman.conf <<EOF

[$PACKAGE]
SigLevel = Required DatabaseRequired
Server = file:///repo/arch/\$arch
EOF
# pacman's download sandbox fails in unprivileged Docker containers (observed
# locally under emulation; CI runs natively).
sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
grep -qx DisableSandbox /etc/pacman.conf
# The databases carry no embedded signatures, so this install also proves pacman fetched <pkg>.sig.
pacman -Syu --noconfirm "$PACKAGE" pax-utils
"$APP" --help >/dev/null
test "$(stat -c %u:%g:%a "/usr/share/$APP/chrome-sandbox")" = "0:0:4755"
test -f "/usr/share/licenses/$PACKAGE/LICENSE"
ls /usr/share/applications/*.desktop | grep -q .
# depends= is hand-maintained; the GUI binary must resolve every library from it.
if lddtree -l "/usr/share/$APP/$APP" 2>&1 | grep -q 'not found'; then
  lddtree "/usr/share/$APP/$APP"; echo 'Arch package is missing a runtime dependency' >&2; exit 1
fi
mkdir -p /root/.dev/reviews /root/.config/Review/User
for SENTINEL in /root/.dev/reviews/package-test /root/.config/Review/User/settings.json; do printf 'keep me\n' > "$SENTINEL"; done
pacman -R --noconfirm "$PACKAGE"
test ! -e "/usr/share/$APP"
for SENTINEL in /root/.dev/reviews/package-test /root/.config/Review/User/settings.json; do test "$(cat "$SENTINEL")" = 'keep me'; done

# A changed package must fail its signature. Corrupt bytes in place: appending
# bytes changes the file size, which pacman rejects as an oversized download
# before it ever checks the checksum/signature, masking the real assertion.
PKG_FILE="$(ls "$REPO/$PACKAGE"-*.pkg.tar.zst)"
dd if=/dev/urandom of="$PKG_FILE" bs=1 count=4 seek=100000 conv=notrunc status=none
# pacman -Scc --noconfirm leaves the cache alone: its second confirmation
# defaults to No, and --noconfirm accepts the default. Clear it directly.
rm -rf /var/cache/pacman/pkg/*
if pacman -Sw --noconfirm "$PACKAGE" > /tmp/tampered-pkg 2>&1; then
  cat /tmp/tampered-pkg; echo 'pacman accepted a tampered package' >&2; exit 1
fi
grep -Eiq 'signature|invalid|corrupt' /tmp/tampered-pkg
cp "/publication/$PREFIX/arch/x86_64/$PACKAGE"-*.pkg.tar.zst "$REPO/"

# A changed database must fail DatabaseRequired.
printf tampered >> "$REPO/$PACKAGE.db"
if pacman -Syy > /tmp/tampered-db 2>&1; then
  cat /tmp/tampered-db; echo 'pacman accepted a tampered database' >&2; exit 1
fi
grep -Eiq 'signature|invalid|corrupt' /tmp/tampered-db
cp "/repo/snapshots/$GENERATION/arch/x86_64/$PACKAGE.db" "$REPO/"

# An untrusted key must fail.
pacman-key --delete "$FINGERPRINT"
if pacman -Syy > /tmp/untrusted 2>&1; then
  cat /tmp/untrusted; echo 'pacman accepted an untrusted repository' >&2; exit 1
fi
grep -Eiq 'signature|unknown|trust|key' /tmp/untrusted
