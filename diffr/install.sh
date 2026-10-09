#!/bin/sh
# Install diffr: curl -fsSL https://install.dev.fast/diffr | sh
#
# Downloads the newest diffr release (or DIFFR_VERSION) for this machine,
# checks it against the release's SHA256SUMS, puts diffr and diffr-tui in
# DIFFR_INSTALL_DIR (default ~/.local/bin), then runs `diffr config init`.
set -eu

REPO=devdotfast/whiteboard

fail() {
	echo "diffr install: $*" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || fail "needs $1"
}

need curl
need tar
need uname

case "$(uname -s)-$(uname -m)" in
Darwin-arm64) target=aarch64-apple-darwin ;;
Darwin-x86_64) target=x86_64-apple-darwin ;;
Linux-x86_64) target=x86_64-unknown-linux-gnu ;;
Linux-aarch64 | Linux-arm64) target=aarch64-unknown-linux-gnu ;;
*) fail "no diffr release for $(uname -s) $(uname -m)" ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
	sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
	sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
	fail "needs sha256sum or shasum"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -n "${DIFFR_VERSION:-}" ]; then
	version=$DIFFR_VERSION
else
	curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100" -o "$work/releases.json" ||
		fail "could not list releases of $REPO"
	# Newest first; Whiteboard's own releases share the list.
	version=$(tr ',' '\n' <"$work/releases.json" |
		sed -n 's|.*"tag_name": *"diffr/\([^"]*\)".*|\1|p' | head -n 1)
	[ -n "$version" ] || fail "$REPO has no diffr release"
fi

archive="diffr-$version-$target.tar.gz"
url="https://github.com/$REPO/releases/download/diffr%2F$version"

echo "Downloading diffr $version for $target"
curl -fsSL "$url/$archive" -o "$work/$archive" || fail "could not download $url/$archive"
curl -fsSL "$url/SHA256SUMS" -o "$work/SHA256SUMS" || fail "could not download $url/SHA256SUMS"
expected=$(sed -n "s/^\([0-9a-f]\{64\}\)  $archive\$/\1/p" "$work/SHA256SUMS")
[ -n "$expected" ] || fail "SHA256SUMS has no entry for $archive"
[ "$(sha256 "$work/$archive")" = "$expected" ] || fail "$archive does not match SHA256SUMS"

dir=${DIFFR_INSTALL_DIR:-$HOME/.local/bin}
mkdir -p "$work/extract" "$dir"
tar -xzf "$work/$archive" -C "$work/extract" diffr diffr-tui
for binary in diffr diffr-tui; do
	# Move into place, so a running diffr keeps its old file.
	cp "$work/extract/$binary" "$dir/.$binary.new"
	chmod 755 "$dir/.$binary.new"
	mv -f "$dir/.$binary.new" "$dir/$binary"
done
echo "Installed $("$dir/diffr" --version) in $dir"

case ":$PATH:" in
*":$dir:"*) ;;
*) echo "Add $dir to your PATH to run diffr by name" ;;
esac

# The script itself arrives on stdin, so the prompts read the terminal.
if [ -t 1 ] && { : </dev/tty; } 2>/dev/null; then
	exec "$dir/diffr" config init </dev/tty
fi
echo "No terminal: run '$dir/diffr config init --json' to finish setup"
