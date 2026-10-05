#!/bin/sh
# Build step: sshd, git and Node ($NODE: a major version or "none"), and the user `dev` with $LOGIN_SHELL.
# $TOOLCHAIN (rust, swift or dotnet) names the toolchain its base image carries.
set -eu
packages="openssh-server git curl ca-certificates procps iproute2 bash"
[ "$LOGIN_SHELL" = fish ] && packages="$packages fish"
if command -v apk >/dev/null; then
  [ "$NODE" = none ] || packages="$packages nodejs npm"
  apk add --no-cache $packages >/dev/null
  adduser -D -s "$(command -v "$LOGIN_SHELL")" dev
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends $packages xz-utils >/dev/null
  rm -rf /var/lib/apt/lists/*
  useradd -m -s "$(command -v "$LOGIN_SHELL")" dev
  if [ "$NODE" != none ]; then
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) exit 1 ;; esac
    dist="https://nodejs.org/dist/latest-v$NODE.x"
    file=$(curl -fsSL "$dist/SHASUMS256.txt" | grep -o "node-v[0-9.]*-linux-$arch.tar.xz" | head -1)
    curl -fsSL "$dist/$file" | tar -xJ -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE
  fi
fi
# sshd does not pass on the image's ENV: rustup and the .NET SDK reach PATH only through the login shell,
# as a hand install leaves them. Swift is in /usr/bin.
case "$TOOLCHAIN" in
  rust) printf '%s\n' 'export RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo' 'export PATH="/usr/local/cargo/bin:$PATH"' >> /home/dev/.profile ;;
  dotnet)
    rm -f /usr/bin/dotnet
    printf '%s\n' 'export DOTNET_ROOT=/usr/share/dotnet DOTNET_CLI_TELEMETRY_OPTOUT=1' 'export PATH="/usr/share/dotnet:$PATH"' >> /home/dev/.profile
    ;;
esac
# A `*` password field is not locked, so key logins work where sshd checks for locked accounts.
echo 'dev:*' | chpasswd -e
rm -f /etc/ssh/ssh_host_*
