#!/bin/sh
# Container entry. WB_PUBLIC_KEY is authorized for `dev`. Optional: WB_PASSWORD turns on password
# logins, WB_BANNER=1 adds a login banner and start-up file output, WB_FORWARDING=0 refuses forwarding.
set -eu
ssh-keygen -A >/dev/null
mkdir -p /run/sshd /home/dev/.ssh
printf '%s\n' "$WB_PUBLIC_KEY" > /home/dev/.ssh/authorized_keys
chown -R dev /home/dev/.ssh
chmod 700 /home/dev/.ssh
chmod 600 /home/dev/.ssh/authorized_keys
password=no
forwarding=yes
if [ -n "${WB_PASSWORD:-}" ]; then
  echo "dev:$WB_PASSWORD" | chpasswd
  password=yes
fi
[ "${WB_FORWARDING:-1}" = 0 ] && forwarding=no
config=/etc/ssh/wb-test.conf
# DEBUG1 logs each forwarded connection, which live checks read with `remote.mjs logs`.
cat > "$config" <<CONF
Port 22
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
AuthorizedKeysFile .ssh/authorized_keys
PermitRootLogin no
PasswordAuthentication $password
KbdInteractiveAuthentication no
AllowTcpForwarding $forwarding
Subsystem sftp internal-sftp
LogLevel DEBUG1
CONF
if [ "${WB_BANNER:-0}" = 1 ]; then
  echo "wb-test login banner" > /etc/ssh/wb-test-banner
  echo "Banner /etc/ssh/wb-test-banner" >> "$config"
  # First line, so it also runs where .bashrc returns early for non-interactive shells.
  { echo 'echo "wb-test start-up file"'; cat /home/dev/.bashrc 2>/dev/null || true; } > /tmp/bashrc
  mv /tmp/bashrc /home/dev/.bashrc
  mkdir -p /home/dev/.config/fish
  echo 'echo "wb-test start-up file"' >> /home/dev/.config/fish/config.fish
  chown -R dev /home/dev/.bashrc /home/dev/.config
fi
exec /usr/sbin/sshd -D -e -f "$config"
