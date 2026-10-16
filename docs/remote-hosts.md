# Remote hosts

A remote host is a Linux machine you reach over SSH, such as a devbox or a
cloud VM, where your code and your coding agent live. Whiteboard runs its
review server there, next to the code, and Desktop lists the host's reviews in
Home beside your local ones. Remote hosts are experimental.

## Requirements

The remote needs:

- Linux on x64 or ARM64 with glibc 2.34 or newer (Ubuntu 22.04, Debian 12,
  Fedora 35, RHEL 9 or later), and 1 GB free in your home directory.
- `tar`, `xz`, `curl` or `wget`, and `sha256sum` or `openssl`.
- HTTPS access to `install.dev.fast`, and to `open-vsx.org` for hovers and go
  to definition.
- An OpenSSH server that allows TCP forwarding (the default).

Your laptop needs the OpenSSH client.

## Add a host

1. Make sure `ssh <alias>` works in a terminal. Whiteboard uses your SSH config
   and stores only the alias.
2. In Settings, under **Remote Hosts (Experimental)**, enter the alias and
   select **Add**.
3. Accept the install prompt the first time.

When the host shows `online`, its reviews appear in Home. Desktop starts the
review server on the host when it connects; you do not start anything there.

On macOS and Linux, SSH password, passphrase and host key prompts appear in
Whiteboard's window. Answers go to `ssh` and are never stored. On Windows,
Whiteboard cannot show SSH prompts: use a key without a passphrase or load it
into `ssh-agent`, and run `ssh <alias>` once in a terminal to accept the host
key.

### Agents

Once a host is `online`, Settings lists its agents. **Connect** runs the
agent's own setup on the host. Ask on a remote review runs the agent on the
host, using the sign-ins already there.

### Install by hand

Desktop installs Whiteboard on the host with your consent. To install it
yourself, run this on the remote with `<version>` set to Desktop's version:

```sh
curl -fsSL https://install.dev.fast/releases/<version>/remote/install.sh | sh -s -- --version <version>
```

The `review.remote.install` setting is `ask` (the default, once per host),
`always`, or `never` (use the `whiteboard` already on the host's `PATH`).

## Trust model

Whiteboard follows VS Code Remote-SSH: add only hosts you trust as much as
your laptop. A connected host is not sandboxed.

- **SSH is the boundary.** Your SSH config applies as-is, including agent and
  port forwarding. Verify a new or changed host key's fingerprint before
  accepting it.
- **Nothing listens publicly.** The review server and VS Code server bind to
  the remote's loopback interface and are reached only through SSH forwards.
- **Review server tokens.** The remote server's token is read over SSH at
  attach and stays in the laptop's local review server, which adds it to
  proxied requests. The laptop's own token is stripped and never reaches the
  remote.
- **VS Code server token.** New each time the server starts. Unlike the review
  server's token, it reaches the window, which connects to the VS Code server
  directly. Desktop hands it only to a window that asks for an `online` host
  running the same version, never on a command line, and never logs it.
- **Extensions** run on the remote and can do in the window what a local
  extension can. Review code stays read-only. An extension asking for call or
  type hierarchies may get answers about another remote's files.
- **Install** runs as your user, with explicit consent the first time
  (`review.remote.install`), from `install.dev.fast`, verified against a
  checksum pinned in Desktop.
- **Shared server.** Every Desktop connected to a remote receives the reviews
  its agent opens.

## Troubleshooting

First check that `ssh <alias>` works in a terminal without prompts you have
not answered before.

| State | Meaning | Fix |
|---|---|---|
| `connecting` | Opening SSH and starting the review server. | Wait. |
| `installing` | Installing Desktop's version on the host. | Wait. |
| `online` | Connected; reviews listed and open. | — |
| `offline` | SSH is up but the review server does not answer (checked every 10 s, so within ~15 s). | Usually recovers. After three missed checks Desktop reattaches; a hung server then shows `unreachable` and the detail says to run `whiteboard server stop` on the host. |
| `unreachable` | `ssh` failed, the connection dropped, or the server did not start. | Desktop retries every 1–60 s; **Retry** tries now. Follow the detail. |
| `auth-failed` | Login refused, prompt cancelled, or host key mismatch. | Fix the login, then **Retry**. Not retried automatically. |
| `not-installed` | Desktop's version is missing and was not installed. | **Install**, or [install by hand](#install-by-hand) and **Retry**. |
| `unsupported` | The machine cannot run Whiteboard. Nothing was written. | Use another machine. |
| `incompatible` | The host runs another Whiteboard version. | Run `whiteboard server stop` on the host and **Retry**, or update Desktop. |
| `duplicate` | Several hosts report the same server id; none is used. | Same machine under two aliases: remove all but one. A copied review store: remove the copy's host, run `whiteboard server stop` then `whiteboard server reset-id` on it, and re-add. |

While a host is not `online`, its reviews stay in Home as unavailable, and
opening one says why.

Common problems:

- **"administratively prohibited" / `unreachable`:** `sshd_config` sets
  `AllowTcpForwarding no`. Whiteboard needs TCP forwarding.
- **No hovers:** Settings shows "Language features" under each online host
  with the reason. Usually a version mismatch between Desktop and the host,
  no access to Open VSX, or a missing toolchain (for example "swift was not
  found on the login shell's PATH"). Put toolchains on your login shell's
  `PATH` (`~/.profile` is enough).
- **`whiteboard server stop` does not stick:** a connected Desktop restarts
  the server within ~10 s. Remove the host first.
- **Windows asks for nothing and fails:** see [Add a host](#add-a-host) for
  the Windows key and host key steps.

## Not available for remote reviews yet

- Sharing.
- Traces.
- Scratchpads; the scratchpad is always the laptop's.

## Remove a host

**Remove** in Settings takes the host and its reviews out of Whiteboard and
deletes nothing on the remote. Check **Also remove Whiteboard from `<alias>`**
to also stop the servers Whiteboard started and delete
`~/.dev/whiteboard-remote/` and its `~/.local/bin/whiteboard`. Reviews stay,
and Desktop forgets your install answer. Nothing is removed while an install
or a process you started from the install is running.

On the remote, `whiteboard remote uninstall --keep-reviews` does the same;
`--delete-reviews` also deletes reviews.
