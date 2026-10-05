#!/usr/bin/env bash
set -euo pipefail
PUBLICATION="$(cd "${1:?usage: verify-nixos.sh publication-directory}" && pwd -P)"
PREFIX=repos
if [[ -f "$PUBLICATION/repos/preview/current.json" ]]; then PREFIX=repos/preview; fi
read -r APP GENERATION FINGERPRINT < <(python3 - "$PUBLICATION/$PREFIX/current.json" <<'PY'
import json, sys
pointer = json.load(open(sys.argv[1]))
assert pointer.get("nixos") is True, "Publication has no NixOS package"
print(pointer["packageName"], pointer["generation"], pointer["keyFingerprint"])
PY
)
PACKAGE="$PUBLICATION/$PREFIX/snapshots/$GENERATION/nixos/x86_64/$APP.nix.tar.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -m 0700 "$WORK/gnupg"
gpg --homedir "$WORK/gnupg" --batch --import "$PUBLICATION/repos/keys/$FINGERPRINT.asc"
gpg --homedir "$WORK/gnupg" --batch --verify "$PACKAGE.asc" "$PACKAGE"
cp "$PACKAGE" "$WORK/tampered.nix.tar.gz"
printf tampered >> "$WORK/tampered.nix.tar.gz"
if gpg --homedir "$WORK/gnupg" --batch --verify "$PACKAGE.asc" "$WORK/tampered.nix.tar.gz"; then
  echo 'NixOS archive tampering was accepted' >&2; exit 1
fi
FLAKE="file://$PACKAGE"
nix flake check --no-build --no-update-lock-file "$FLAKE"
nix build --no-update-lock-file "$FLAKE#default" --out-link "$WORK/result"
nix build -L --no-update-lock-file "$FLAKE#checks.x86_64-linux.nixos" --out-link "$WORK/validation"
mkdir -p nixos-validation
cp -RL "$WORK/validation/." nixos-validation/
