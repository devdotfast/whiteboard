#!/bin/sh
# Install script for diffr:
#   1. installs native binary through this shell script
#   2. runs an interactive init command to set up AI pseudocode generation, etc. 
#      Non-interactive environments are detected and should pass in config via the --json flag (visible in first error msg).
# Install diffr: curl -fsSL https://install.dev.fast/diffr | sh
#
# Download the newest diffr release (or DIFFR_VERSION) for this machine,
# puts diffr in DIFFR_INSTALL_DIR (default ~/.local/bin), then runs `diffr config init`
set -eu

REPO=devdotfast/whiteboard

fail() {
	echo "diffr install: $*" >&2
	echo >&2
	echo "This may be a bug, in which case we are very sorry! To help us fix it, please file an issue at https://github.com/devdotfast/whiteboard/issues. Thank you!" >&2
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
*) fail "no diffr release for architecture: $(uname -s) $(uname -m)." ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
	sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
	sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
	fail "needs sha256sum or shasum installed; please install with your package manager of choice and retry!"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -n "${DIFFR_VERSION:-}" ]; then
	version=$DIFFR_VERSION
else
	curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100" -o "$work/releases.json" ||
		fail "could not list releases of $REPO to fetch diffr target version"
	# Newest first; Whiteboard's own releases share the list.
	version=$(tr ',' '\n' <"$work/releases.json" |
		sed -n 's|.*"tag_name": *"diffr/\([^"]*\)".*|\1|p' | head -n 1)
	[ -n "$version" ] || fail "$REPO has no diffr release available"
fi

archive="diffr-$version-$target.tar.gz"
url="https://github.com/$REPO/releases/download/diffr%2F$version"

echo "Downloading diffr $version for $target"
curl -fsSL "$url/$archive" -o "$work/$archive" || fail "could not download $url/$archive"
curl -fsSL "$url/SHA256SUMS" -o "$work/SHA256SUMS" || fail "could not download $url/SHA256SUMS"
expected=$(sed -n "s/^\([0-9a-f]\{64\}\)  $archive\$/\1/p" "$work/SHA256SUMS")
[ -n "$expected" ] || fail "could not find entry for diffr $version in working dir $work after downloading it"
[ "$(sha256 "$work/$archive")" = "$expected" ] || fail "$archive does not match expected sha256sum of diffr binary"

dir=${DIFFR_INSTALL_DIR:-$HOME/.local/bin}
mkdir -p "$work/extract" "$dir"
tar -xzf "$work/$archive" -C "$work/extract" diffr diffr-tui
first=1
[ ! -e "$dir/diffr" ] || first=
for binary in diffr diffr-tui; do
	# Move into place, so a running diffr keeps its old file.
	cp "$work/extract/$binary" "$dir/.$binary.new"
	chmod 755 "$dir/.$binary.new"
	mv -f "$dir/.$binary.new" "$dir/$binary"
done
echo "Installed $("$dir/diffr" --version) in $dir"

# The script itself arrives on stdin, so questions read the terminal.
terminal() {
	[ -t 1 ] && { : </dev/tty; } 2>/dev/null
}

# On a first install, offer to add $dir to PATH in the shell's startup file.
case ":$PATH:" in
*":$dir:"*) ;;
*)
	rc= line="export PATH=\"$dir:\$PATH\""
	case "${SHELL##*/}" in
	zsh) rc=${ZDOTDIR:-$HOME}/.zshrc ;;
	bash) if [ "$(uname -s)" = Darwin ]; then rc=$HOME/.bash_profile; else rc=$HOME/.bashrc; fi ;;
	fish) rc=${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish line="fish_add_path $dir" ;;
	esac
	answer=n
	if [ -n "$first" ] && [ -n "$rc" ] && terminal; then
		printf "Add %s to your PATH in %s? [Y/n] " "$dir" "$rc"
		read -r answer </dev/tty
	fi
	case $answer in
	"" | y | Y | yes)
		mkdir -p "$(dirname "$rc")"
		printf '\n# diffr\n%s\n' "$line" >>"$rc"
		echo "Added $dir to your PATH in $rc; it applies in new shells"
		;;
	*) echo "next, add diffr's install path ($dir) to your PATH" ;;
	esac
	;;
esac

[ -n "$first" ] || exit 0

if terminal; then
	exec "$dir/diffr" config init </dev/tty
fi
echo "No terminal detected (are you an AI agent?): run '$dir/diffr config init --json' to finish setup"
