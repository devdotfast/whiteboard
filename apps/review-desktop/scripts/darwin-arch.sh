# shellcheck shell=bash
# Sets DARWIN_ARCH/DARWIN_TARGET for the macOS host.
case "$(uname -m)" in
  arm64) DARWIN_ARCH=arm64 ;;
  x86_64) DARWIN_ARCH=x64 ;;
  *) echo "Unsupported macOS arch $(uname -m)" >&2; exit 1 ;;
esac
DARWIN_TARGET="darwin-$DARWIN_ARCH"
export DARWIN_ARCH DARWIN_TARGET
