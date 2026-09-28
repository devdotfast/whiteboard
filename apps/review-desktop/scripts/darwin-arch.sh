# shellcheck shell=bash
# Exports the macOS release arch for the host. Sourced by the macOS-only scripts.
case "$(uname -m)" in
  arm64) DARWIN_ARCH=arm64 ;;
  x86_64) DARWIN_ARCH=x64 ;;
  *) echo "Unsupported macOS arch $(uname -m)" >&2; exit 1 ;;
esac
DARWIN_TARGET="darwin-$DARWIN_ARCH"
export DARWIN_ARCH DARWIN_TARGET
