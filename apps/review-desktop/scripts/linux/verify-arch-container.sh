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
# The pinned image's archlinux-keyring can predate keys used to sign current
# packages; refresh it before syncing, or -Syu fails on signature checks.
pacman -Sy --noconfirm archlinux-keyring
# The databases carry no embedded signatures, so this install also proves pacman fetched <pkg>.sig.
pacman -Syu --noconfirm "$PACKAGE"
"$APP" --help >/dev/null
test "$(stat -c %u:%g:%a "/usr/share/$APP/chrome-sandbox")" = "0:0:4755"
test -f "/usr/share/licenses/$PACKAGE/LICENSE"
ls /usr/share/applications/*.desktop | grep -q .
# depends= is hand-maintained; the GUI binary must resolve every library from it.
# (lddtree -l prints an unresolved lib as a bare name, not "not found"; plain ldd is reliable.)
LDD_OUT="$(ldd "/usr/share/$APP/$APP" 2>&1)"
if grep -q 'not found' <<<"$LDD_OUT"; then
  echo "$LDD_OUT"; echo 'Arch package is missing a runtime dependency' >&2; exit 1
fi
mkdir -p /root/.dev/reviews /root/.config/Review/User
for SENTINEL in /root/.dev/reviews/package-test /root/.config/Review/User/settings.json; do printf 'keep me\n' > "$SENTINEL"; done
pacman -R --noconfirm "$PACKAGE"
test ! -e "/usr/share/$APP"
for SENTINEL in /root/.dev/reviews/package-test /root/.config/Review/User/settings.json; do test "$(cat "$SENTINEL")" = 'keep me'; done

# A changed package must fail the signed database's checksum check (%SHA256SUM%).
# Corrupt bytes in place: appending bytes changes the file size, which pacman
# rejects as an oversized download before it ever checks the checksum, masking
# the real assertion.
PKG_FILE="$(ls "$REPO/$PACKAGE"-*.pkg.tar.zst)"
dd if=/dev/urandom of="$PKG_FILE" bs=1 count=4 seek=100000 conv=notrunc status=none
# pacman -Scc --noconfirm leaves the cache alone: its second confirmation
# defaults to No, and --noconfirm accepts the default. Clear it directly.
rm -rf /var/cache/pacman/pkg/*
if pacman -Sw --noconfirm "$PACKAGE" > /tmp/tampered-pkg 2>&1; then
  cat /tmp/tampered-pkg; echo 'pacman accepted a tampered package' >&2; exit 1
fi
grep -Eq 'invalid or corrupted package \(checksum\)' /tmp/tampered-pkg
cp "/publication/$PREFIX/arch/x86_64/$PACKAGE"-*.pkg.tar.zst "$REPO/"

# A changed <pkg>.sig, with the package bytes and checksum untouched, must
# separately fail the package's PGP signature -- proving pacman fetches and
# enforces the detached signature, not just the database checksum.
SIG_FILE="$(ls "$REPO/$PACKAGE"-*.pkg.tar.zst.sig)"
dd if=/dev/urandom of="$SIG_FILE" bs=1 count=4 seek=100 conv=notrunc status=none
rm -rf /var/cache/pacman/pkg/*
if pacman -Sw --noconfirm "$PACKAGE" > /tmp/tampered-sig 2>&1; then
  cat /tmp/tampered-sig; echo 'pacman accepted a package with a tampered signature' >&2; exit 1
fi
grep -Eq 'invalid or corrupted package \(PGP signature\)' /tmp/tampered-sig
cp "/publication/$PREFIX/arch/x86_64/$PACKAGE"-*.pkg.tar.zst.sig "$REPO/"

# A changed database must fail DatabaseRequired.
printf tampered >> "$REPO/$PACKAGE.db"
if pacman -Syy > /tmp/tampered-db 2>&1; then
  cat /tmp/tampered-db; echo 'pacman accepted a tampered database' >&2; exit 1
fi
grep -Eq 'invalid or corrupted database \(PGP signature\)' /tmp/tampered-db
cp "/repo/snapshots/$GENERATION/arch/x86_64/$PACKAGE.db" "$REPO/"

# An untrusted key must fail. </dev/null: a default-Yes import prompt must
# never become a live keyserver fetch, even if -it is added here later.
pacman-key --delete "$FINGERPRINT"
if pacman -Syy </dev/null > /tmp/untrusted 2>&1; then
  cat /tmp/untrusted; echo 'pacman accepted an untrusted repository' >&2; exit 1
fi
# pacman names the key that made the signature: the release key signs with a
# subkey, so accept any fingerprint from the published key.
SIGNING_KEYS="$(gpg --show-keys --with-colons "/publication/repos/keys/$FINGERPRINT.asc" | awk -F: '$1 == "fpr" {print $10}' | paste -sd '|')"
grep -Eq "key \"($SIGNING_KEYS)\" is unknown" /tmp/untrusted
