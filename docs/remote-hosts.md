# Remote hosts

A remote host is a Linux machine you reach over SSH, such as a devbox or a
cloud VM, where your code and your coding agent live. Whiteboard runs its
review server there, next to the code. Desktop connects over SSH and lists the
host's reviews in Home beside your local ones, labelled `devbox: my-repo`.

Remote hosts are experimental.

## Setup

### Requirements

The remote:

- Linux on x64 or ARM64, glibc 2.34 or newer (Ubuntu 22.04, Debian 12,
  Fedora 35, RHEL 9 or later).
- A writable home directory with 1 GB free.
- `tar`, `xz`, `curl` or `wget`, and `sha256sum` or `openssl`.
- HTTPS access to `install.dev.fast`, and to `open-vsx.org` for
  [language features](#language-features).
- An OpenSSH server that allows TCP forwarding (the default).

Your laptop: the OpenSSH client. On Windows, the built-in OpenSSH Client; see
[Windows laptops](#windows-laptops).

### Add a host

1. Make sure `ssh <alias>` works in a terminal. Whiteboard uses your SSH
   config for users, keys, ports, jump hosts and agents, and stores only the
   alias.
2. In Settings, under **Remote Hosts (Experimental)**, type the alias (the
   field suggests them) and click **Add**.
3. Accept the install prompt the first time.

When the row reads `online`, the host's reviews appear in Home. You do not
start anything on the remote: Desktop starts the review server when it
connects. On a remote with no Desktop connected, `whiteboard api` starts one,
so an agent there can write reviews before you connect.

On macOS and Linux, password, passphrase and host key prompts from `ssh`
appear in Whiteboard's window. Answers go to `ssh` and are never stored.

Hosts are kept in `review.remote.hosts`, a list of aliases. Only you can
change it; a repository or a remote never adds a host.

### Windows laptops

Whiteboard cannot show SSH prompts on Windows:

- Use a key without a passphrase, or load it into `ssh-agent`:

  ```powershell
  Get-Service ssh-agent | Set-Service -StartupType Automatic -PassThru | Start-Service
  ssh-add
  ```

- Run `ssh <alias>` once in a terminal to accept the host key.

### Agents

Once a host is `online`, Settings lists its unconnected agents (Claude Code,
Codex, OpenCode, Pi). **Connect** runs the agent's own install commands on the
host.

Ask on a remote review runs the agent on the host, in the review's checkout,
using the sign-ins already there (`claude auth login`, `codex login`,
`opencode auth login`, `cursor-agent login`, Pi's `/login`).

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
- **Windows asks for nothing and fails:** see
  [Windows laptops](#windows-laptops).

## How it works

### Connection

On macOS and Linux, Desktop opens one SSH master connection per host
(`ControlMaster`) and runs every command and port forward over it. On Windows,
which has no `ControlMaster`, a master connection serves a loopback SOCKS port
for forwards, and each command opens its own `BatchMode` connection.

The remote review server listens only on the remote's loopback interface.
Desktop's local review server reaches it through an SSH port forward and acts
as a gateway: the canvas talks only to the local server, which proxies remote
reviews with the remote server's token. Language features use a second
forward, to a VS Code server also on loopback.

### Install and updates

Desktop first probes the host and writes nothing. With no install it
recognises, it asks once, then installs as your user; a host with a
recognised install gets new versions without asking. The host downloads the
archive from `install.dev.fast` and verifies Desktop's pinned checksum before
unpacking. Desktop runs the same `install.sh` you can run by hand.

On update, Desktop installs its new version (also over a hand install),
restarts the server it started, and keeps the previous version and any
version still running. A server you started yourself keeps running.

`review.remote.install` controls this:

| Value | Behavior |
|---|---|
| `ask` (default) | Ask once per host, unless it has a recognised install. |
| `always` | Install without asking. |
| `never` | Never install; use `whiteboard` on the host's `PATH`. |

What Desktop writes on the remote:

| Path | What it is |
|---|---|
| `~/.dev/whiteboard-remote/versions/<version>/` | One version, ~250 MB, with its own Node. |
| `~/.dev/whiteboard-remote/install.lock/` | Present while an install runs. |
| `~/.local/bin/whiteboard` | Launcher for the newest version, if that path is free or already Desktop's. |

With `DEV_REVIEW_HOME` set on the remote, `whiteboard-remote/` lives under it.
Reviews are kept in `~/.dev`.

#### Install by hand

On the remote, with `<version>` set to Desktop's version:

```sh
curl -fsSL https://install.dev.fast/releases/<version>/remote/install.sh | sh -s -- --version <version>
```

It installs where Desktop does, so Desktop finds it.

### Language features

Hover and go to definition in remote reviews are answered on the remote by
the same extensions a local review uses. Desktop runs one VS Code server and
extension host per connected remote; the server exits 5 minutes after the
last window leaves.

- **Languages:** TypeScript, JavaScript, JSON, CSS and HTML always; Python
  with ty; Go, Rust, Swift and C# when their group is on (Settings → Tools →
  Extensions).
- **First connect:** the remote downloads its extensions from Open VSX (a few
  seconds to a minute), each checked against a checksum Whiteboard pins.
  Whiteboard redistributes none of them. Without Open VSX access, reviews
  still open, without hovers.
- **Memory:** ~1 GB for one TypeScript plus one Python project, ~0.8 GB for
  TypeScript alone, ~1 GB for a small Rust project.
- **Version:** both ends must run the same Whiteboard version. Otherwise the
  host stays `online` without language features.

Optional groups are installed on each remote at its next connection, at your
laptop's version. Groups you never turned on are never installed; turning one
off leaves it on the remote, unused.

| Group | Needs on the remote's login `PATH` | Downloads |
|---|---|---|
| Go | `go` | Go |
| Rust | `cargo`, `rustc` | rust-analyzer, ~16 MB |
| Swift | `swift` | Swift, LLDB DAP, ~16 MB |
| C# | `dotnet` (.NET SDK) | C#, .NET Runtime, ~80 MB; OmniSharp from Microsoft on first start |

Swift and C# install but do not answer hovers yet, locally or remotely: Swift
needs the task API, and on remotes `node-pty`. Their debuggers never start;
reviews are read-only.

### Source windows

"Open file", the source tree and Ask's file links open a read-only Source
window on the host, with search and language features. Each window runs its
own extension host on the host; close ones you are done with. When the host
stops answering, the status bar offers Retry and the window reconnects when
the host is back.

Source windows have no terminals or source control. On musl hosts such as
Alpine, the explorer refreshes on focus instead of live.

### Ask

Ask threads are kept on the host, so every laptop connected to it sees the
same history.

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

## Developing

A development Desktop pins no archive. Set `DEV_FAST_REVIEW_REMOTE_RELEASES` to
a URL serving the archives and their `.sha256` files, or install this
checkout's archive with
`node apps/review-desktop/scripts/remote-dev-install.mjs <alias>`. With
`DEV_FAST_REVIEW_REMOTE_PUBLISH=1` and Cloudflare credentials, the script
publishes the archives and prints the URL to export.
