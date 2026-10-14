# Remote hosts

A remote host is a Linux machine that you reach over SSH, such as a
development server or a cloud VM, where your code and your coding agent live.
Whiteboard runs its review server there, next to the code. Whiteboard Desktop
on your laptop connects to it over SSH and shows its reviews beside your local
ones: in Home, each one is labelled with the host, as `devbox: my-repo`.

Whiteboard uses your own SSH configuration. A host is an alias from it, such
as `devbox`. User names, keys, ports, jump hosts and agents all come from that
configuration; Whiteboard stores only the alias.

## Trust

Add only hosts you trust as much as your laptop. Like VS Code Remote-SSH,
Whiteboard does not sandbox a connected host. Verify a new or changed host
key's fingerprint before accepting it. Agent and port forwarding from your SSH
config apply to Whiteboard's connections too.

## What the remote needs

- Linux on x64 or ARM64, with glibc 2.34 or newer (Ubuntu 22.04, Debian 12,
  Fedora 35, RHEL 9 or later).
- A writable home directory with 1 GB free.
- `tar`, `xz`, `curl` or `wget`, and `sha256sum` or `openssl`.
- HTTPS access to `install.dev.fast`.
- An OpenSSH server that allows TCP forwarding. See
  [TCP forwarding](#tcp-forwarding).

Your laptop needs macOS or Linux with the OpenSSH client. A Windows laptop is
not supported yet.

## Add a host

Remote hosts are experimental. Turn them on in Whiteboard's `settings.json`:

```json
"review.experimental.remoteHosts.enabled": true
```

Then open Settings. Under **Remote hosts**, type an alias from your SSH
configuration (the field suggests them) and click **Add**. The row shows the
host's state. The first time, Desktop asks to install Whiteboard there. When
the row reads `online`, the host's reviews appear in Home.

**Remove** takes the host and its reviews out of Whiteboard. Nothing on the
remote is deleted unless you check
[**Also remove Whiteboard**](#remove-whiteboard-from-a-host).

The hosts are kept in the setting `review.remote.hosts`, a list of aliases.
Only you can change it: a repository or a remote never adds a host.

If `ssh` asks for a password, a passphrase or a host key confirmation,
Whiteboard shows the prompt in its window. Your answer goes to `ssh` and is
never stored.

## How Desktop installs Whiteboard

Desktop first checks the host and writes nothing. If the host has no install
Desktop recognises, Desktop asks once, then installs as your user. A host with
one gets Desktop's new version without a question. The host downloads
it from `install.dev.fast` and checks its pinned checksum before unpacking.
Desktop runs the same `install.sh` you can run by hand.

You do not need to start anything. Desktop starts the review server when it
connects. On a remote with no Desktop, `whiteboard api` starts one too, so an
agent there can write reviews before you connect.

### What Desktop writes on the remote

| Path | What it is |
|---|---|
| `~/.dev/whiteboard-remote/versions/<version>/` | One Whiteboard version, about 250 MB, with its own Node. |
| `~/.dev/whiteboard-remote/install.lock/` | Present while an install runs. |
| `~/.local/bin/whiteboard` | A launcher for the newest version, if that path is free or Desktop's own. |

With `DEV_REVIEW_HOME` set on the remote, `whiteboard-remote/` is under it
instead of `~/.dev`. The review server keeps reviews in `~/.dev`.

### Updates

When Desktop updates, it installs its new version without asking, also over an
`install.sh` hand install. It restarts the review server it started. It keeps
the previous version and any version still running. It leaves a server you
started yourself running.

### The setting

`review.remote.install` decides whether Desktop installs on a host that does
not have its version:

| Value | What Desktop does |
|---|---|
| `ask` (the default) | Asks once per host, unless it already has an install Desktop recognises. |
| `always` | Installs without asking. |
| `never` | Never installs, and uses the `whiteboard` on the host's `PATH`. |

### Install by hand

On the remote, with `<version>` set to Desktop's version:

```sh
curl -fsSL https://install.dev.fast/releases/<version>/remote/install.sh | sh -s -- --version <version>
```

It installs where Desktop does, so Desktop finds it.

### Developing

A development Desktop pins no archive. Set `DEV_FAST_REVIEW_REMOTE_RELEASES` to
a URL that serves the archives and their `.sha256` files, or install this
checkout's archive with `node apps/review-desktop/scripts/remote-dev-install.mjs <alias>`.
With `DEV_FAST_REVIEW_REMOTE_PUBLISH=1` and Cloudflare credentials, the script
publishes the archives and prints the URL to export.

## Agents on the remote

Once a host is `online`, Settings lists its unconnected agents: Claude Code,
Codex, OpenCode and Pi. **Connect** runs the agent's own install commands on
the host.

**Ask.** Ask works on a review that lives on a host. The agent runs on the
host, in the review's checkout, with the agents and sign-ins already there
(`claude auth login`, `codex login`, `opencode auth login`,
`cursor-agent login`, Pi's `/login`). Threads are kept on the host, so every
laptop that connects to it sees the same history for its reviews. A file that
an answer names opens in a Source window on the host; see
[Source windows](#source-windows).

## Remove Whiteboard from a host

In Settings, click **Remove** on the host, check **Also remove Whiteboard from
`<alias>`**, and click **Remove host**. Desktop then stops the servers
Whiteboard started and removes `~/.dev/whiteboard-remote/` and its
`~/.local/bin/whiteboard`. Your reviews stay, and Desktop forgets your install
answer. Nothing is removed while an install or a process you started runs from
the install.

On the remote, `whiteboard remote uninstall --keep-reviews` does the same.
`--delete-reviews` also deletes the reviews.

## States

| State | Meaning | What to do |
|---|---|---|
| `connecting` | Whiteboard is opening the SSH connection and starting the review server. | Wait. |
| `installing` | Desktop is installing its version there. | Wait. |
| `online` | Connected. The host's reviews are listed and open. | Nothing. |
| `offline` | The connection is up, but the review server did not answer. Whiteboard checks every 10 seconds, so a host that hangs shows `offline` within about 15 seconds. | It returns by itself when the server answers. After three checks in a row without an answer, Whiteboard attaches again. A hung server then shows `unreachable`, and its detail names `whiteboard server stop`: run it on the host. |
| `unreachable` | `ssh` could not connect, the connection ended, or the review server there did not start (the detail says why). | Whiteboard tries again by itself, waiting 1 to 60 seconds between tries; **Retry** tries now. Check that `ssh <alias>` works in a terminal, or do what the detail says. |
| `auth-failed` | The login was refused, a prompt was cancelled, or the host key did not match. | Fix the login, then click **Retry**. Whiteboard does not retry this by itself. |
| `not-installed` | Desktop's version is not on the host, and Desktop did not install it. | Click **Install**, or [install by hand](#install-by-hand) and click **Retry**. |
| `unsupported` | Whiteboard cannot run on this machine. Nothing was written there. | Use another machine. |
| `incompatible` | The remote runs another version of Whiteboard. | Stop your server with `whiteboard server stop` and click **Retry**, or update this Desktop. |
| `duplicate` | Two or more hosts report the same server id, so Whiteboard uses none of them. This happens when one machine is added under two aliases, or a review store was copied to a second machine. | If the aliases are one machine, remove all but one. If they are two machines, remove the copy's host, run `whiteboard server stop` and then `whiteboard server reset-id` on the copy, and add it again. |

While a host is not `online`, its reviews stay in Home, drawn as unavailable.
Opening one says why.

## Language features

Hover and go to definition work in a remote review's code, answered on the
remote by the same language extensions a laptop review uses. Desktop runs a
VS Code server and one extension host on each remote it connects to.

- **Which languages:** TypeScript, JavaScript, JSON, CSS and HTML always.
  Python, with ty, Ruff and the Python extension. Go, Rust, Swift and C# when
  you have turned their group on in Whiteboard (Settings → Tools → Extensions);
  see [Optional languages](#optional-languages).
- **First use:** the remote downloads its language extensions from Open VSX
  (`open-vsx.org`) the first time Desktop connects. That takes a few seconds
  to a minute, and the remote needs network access to Open VSX for it. A
  remote without that access still shows its reviews, without hovers.
- **Memory:** plan on about 1 GB for the VS Code server, its extension host and
  the language servers of one TypeScript and one Python project; about 0.8 GB
  with TypeScript alone. The server exits 5 minutes after the last window
  leaves.
- **Same version:** language features need the same Whiteboard version on
  both ends. Otherwise the host stays `online` and its reviews open, and
  Settings says under the host why language features are unavailable.

Settings shows "Language features: available" or why not for each online host.

Extensions on a remote are trusted the way VS Code Remote trusts them: they
run on that machine and can do in the window what a local extension can. The
code in a review stays read-only.

An extension on a remote that asks for call or type hierarchies may also get
answers about another remote's files.

### Optional languages

A group you turn on in Whiteboard is installed on each remote at its next
connection, at the same version as on your laptop. A group you have not turned
on is never installed on a remote. Turning a group off leaves it on the remote,
unused. Each group needs its toolchain on the remote, on the `PATH` of your
login shell (`~/.profile` or your shell's own start-up file is enough):

| Group | Needs on the remote | Extensions the remote downloads |
|---|---|---|
| Go | `go` | Go |
| Rust | `cargo` and `rustc` | rust-analyzer, about 16 MB |
| Swift | `swift` | Swift and LLDB DAP, about 16 MB |
| C# | `dotnet` (a .NET SDK) | C# and .NET Runtime, about 80 MB |

- When a toolchain is missing, the host still connects. Settings says under
  the host which tool the login shell could not find, for example
  "swift: installed — swift was not found on the login shell's PATH".
- **Memory:** a small Rust project needs about 1 GB for the VS Code server,
  its extension host and rust-analyzer.
- **Rust** gives hover and go to definition on remotes. The glibc a remote
  needs for Whiteboard (2.34 or newer) is enough for rust-analyzer.
- **Swift and C#** are installed on a remote but do not answer hovers yet,
  on a remote or on your laptop. Swift's extension needs the task API, which
  Whiteboard does not expose yet, and on a remote also `node-pty`, which the
  remote's VS Code server does not include. In a review's Diff view the C# extension
  loads the project from the review's base side only, so a hover on the
  changed side stays at "Loading...".
- The debuggers in the Swift and C# groups are never started: reviews are
  read-only.
- The remote downloads each extension from Open VSX itself, and checks it
  against the checksum Whiteboard pins. Whiteboard redistributes none of them.
  The C# extension downloads its OmniSharp server from Microsoft the first
  time it starts.

## Source windows

"Open file", the source tree and Ask's file links open a read-only Source
window on the host, with search and language features.

When the host stops answering, the status bar says so and offers Retry. The
window reconnects when the host is back.

Not available in a Source window:

- Terminals and source control.
- Live file updates on musl hosts such as Alpine. The explorer refreshes when
  the window gets focus.

Each Source window runs its own extension host on the host. Close the ones you
are done with.

## Not available for remote reviews yet

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

Language features use a second forward, to the remote's VS Code server on its
loopback interface. That server has its own connection token, new each time it
starts. Unlike the review server's token, it reaches the Desktop window: the
window connects to the VS Code server itself. Desktop hands it only to a window
that asks for an `online` host running the same Whiteboard version, never on a
command line, and never writes it to a log.
