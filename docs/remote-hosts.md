# Remote hosts

A remote host is a Linux machine that you reach over SSH, such as a
development server or a cloud VM, where your code and your coding agent live.
Whiteboard runs its review server there, next to the code. Whiteboard Desktop
on your laptop connects to it over SSH and shows its reviews beside your local
ones: in Home, each one is labelled with the host, as `devbox: my-repo`.

Whiteboard uses your own SSH configuration. A host is an alias from it, such
as `devbox`. User names, keys, ports, jump hosts and agents all come from that
configuration; Whiteboard stores only the alias.

## What the remote needs

- Linux on x64 or ARM64, with glibc 2.34 or newer (Ubuntu 22.04, Debian 12,
  Fedora 35, RHEL 9 or later).
- Node 24.
- An OpenSSH server that allows TCP forwarding. See
  [TCP forwarding](#tcp-forwarding).
- `whiteboard` on the `PATH` of your login shell there.

Your laptop needs macOS or Linux with the OpenSSH client. A Windows laptop is
not supported yet.

## Install Whiteboard on the remote

On the remote, install the version that matches your Desktop:

```sh
npm install -g @dev.fast/whiteboard@<version>
```

Settings shows the exact command, with the version, when a host needs it.
Check the install with `whiteboard version`.

You do not need to start anything. Desktop starts the review server when it
connects. On a remote with no Desktop, `whiteboard api` starts one too, so an
agent there can write reviews before you connect.

## Add a host

Remote hosts are experimental. Turn them on in Whiteboard's `settings.json`:

```json
"review.experimental.remoteHosts.enabled": true
```

Then open Settings. Under **Remote hosts**, type an alias from your SSH
configuration (the field suggests them) and click **Add**. The row shows the
host's state. When it reads `online`, the host's reviews appear in Home.

**Remove** takes the host and its reviews out of Whiteboard. Nothing on the
remote is deleted.

The hosts are kept in the setting `review.remote.hosts`, a list of aliases.
Only you can change it: a repository or a remote never adds a host.

If `ssh` asks for a password, a passphrase or a host key confirmation,
Whiteboard shows the prompt in its window. Your answer goes to `ssh` and is
never stored.

## States

| State | Meaning | What to do |
|---|---|---|
| `connecting` | Whiteboard is opening the SSH connection and starting the review server. | Wait. |
| `online` | Connected. The host's reviews are listed and open. | Nothing. |
| `offline` | The connection is up, but the review server did not answer. Whiteboard checks every 10 seconds, so a host that hangs shows `offline` within about 15 seconds. | It returns by itself when the server answers. After three checks in a row without an answer, Whiteboard attaches again. A hung server then shows `unreachable`, and its detail names `whiteboard server stop`: run it on the host. |
| `unreachable` | `ssh` could not connect, the connection ended, or the review server there did not start (the detail says why). | Whiteboard tries again by itself, waiting 1 to 60 seconds between tries; **Retry** tries now. Check that `ssh <alias>` works in a terminal, or do what the detail says. |
| `auth-failed` | The login was refused, a prompt was cancelled, or the host key did not match. | Fix the login, then click **Retry**. Whiteboard does not retry this by itself. |
| `not-installed` | `whiteboard` was not found on the remote. | Install it with the command that Settings shows, then click **Retry**. Whiteboard does not retry this by itself. |
| `incompatible` | The remote runs another version of Whiteboard. | Run the install command that Settings shows, then `whiteboard server stop` on the remote. Desktop starts the new server within about 10 seconds. |
| `duplicate` | Two hosts report the same server id. This happens when a review store was copied to a second machine. | If both aliases are one machine, remove one of them. If they are two machines, remove the copy's host, run `whiteboard server stop` and then `whiteboard server reset-id` on the copy, and add it again. |

While a host is not `online`, its reviews stay in Home, drawn as unavailable.
Opening one says why.

## Not available for remote reviews yet

- Source windows: "Open file" and the source tree are hidden.
- Language features, such as hover and go to definition, in code on the
  remote.
- Sharing.
- Traces.
- Scratchpads. The scratchpad is always the laptop's.

Also:

- `whiteboard server stop` on a remote is undone within about 10 seconds while
  Desktop is connected to it, because Desktop starts the server again. To stop
  it for good, remove the host first.
- Every Desktop connected to a remote receives the reviews its agent opens.

## TCP forwarding

Whiteboard reaches the remote's review server through an SSH port forward
(`ssh -L`) to a port on the remote's loopback interface. The server never
listens on a public address. So the remote's `sshd` must allow TCP
forwarding, which is OpenSSH's default. If `sshd_config` sets
`AllowTcpForwarding no`, the host shows `unreachable`, and the detail quotes
OpenSSH's "administratively prohibited" message.
