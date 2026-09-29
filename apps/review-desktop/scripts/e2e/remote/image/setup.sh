#!/bin/sh
# Build step: sshd, git and Node ($NODE: a major version or "none"), and the user `dev` with $LOGIN_SHELL.
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
# A `*` password field is not locked, so key logins work where sshd checks for locked accounts.
echo 'dev:*' | chpasswd -e
rm -f /etc/ssh/ssh_host_*
