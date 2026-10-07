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
- 1 GB free in your home directory, which must be writable.
- `sha512sum` or `openssl`. If the host has no Node 24, also `tar`, `xz` and
  `sha256sum`, so that Desktop can install one.
- An OpenSSH server that allows TCP forwarding. See
  [TCP forwarding](#tcp-forwarding).

Nothing else: not Node, not root access, and not an internet connection.
Desktop installs Whiteboard there itself, as your user. See
[How Desktop installs Whiteboard](#how-desktop-installs-whiteboard).

Your laptop needs macOS or Linux with the OpenSSH client, and an internet
connection while it installs on a host that has none. A Windows laptop is not
supported yet.

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
remote is deleted, unless you also check **Also remove Whiteboard**. See
[Remove Whiteboard from a host](#remove-whiteboard-from-a-host).

The hosts are kept in the setting `review.remote.hosts`, a list of aliases.
Only you can change it: a repository or a remote never adds a host.

If `ssh` asks for a password, a passphrase or a host key confirmation,
Whiteboard shows the prompt in its window. Your answer goes to `ssh` and is
never stored.

## How Desktop installs Whiteboard

When Desktop connects to a host, it first checks the machine: its system,
CPU, glibc, home directory, free space, Node, and which Whiteboard versions it
already has. This check only reads, except that it runs `node --version` on
each Node it finds, and a version manager's shim (such as Volta's) may fetch
its Node when run.

- **A machine Whiteboard cannot run on** shows `unsupported`, with the
  reason, such as "This host runs glibc 2.31; Whiteboard needs 2.34 or
  newer." Desktop writes nothing on it.
- **A machine without Desktop's version** gets a question in Desktop's
  window: "Install Whiteboard on `<alias>`?", with the space it takes. Desktop
  asks once per host and remembers the answer until you remove Whiteboard
  from that host.
  - **Install:** Settings shows each step (preparing, installing Node 24,
    installing the Whiteboard package, checking the install, starting the
    server), and then the host is `online`, usually well within a minute.
  - **Don't install:** the host shows `not-installed`, with the command to
    install by hand, and an **Install** button for when you change your mind.
    Reconnecting does not ask again.
- **A machine with Desktop's version** is attached at once.

Desktop installs exactly its own version of the `@dev.fast/whiteboard`
package, and a Node 24 when the host has none. Each release of Desktop pins
both, with their checksums, and the host checks them before it installs
anything. The host downloads them when it can reach the internet. When it
cannot, Desktop downloads them on the laptop and uploads them through the SSH
connection, and the host's npm fetches the package's dependencies through a
relay on the laptop, reached over that same connection only while it installs.
Desktop never uses `sudo`. The install writes only the paths below; npm's
cache and log stay in the unfinished version's directory and go with it. The
review server it starts writes under `~/.dev`, as below, and **Connect**
writes the agent's own configuration.

A Node 24 already on the host is used, and then Desktop installs no Node: one
on the `PATH` of a non-login shell, in `/usr/local/bin` or `/usr/bin`, or under
a version manager such as nvm, fnm, volta, asdf or mise. A Node only on your
login shell's `PATH` is not seen.

If the connection drops while installing, the next connection starts the
install again; nothing half-written is left. Two Desktops installing on one
host at once take turns.

### What Desktop writes on the remote

| Path | What it is |
|---|---|
| `~/.dev/whiteboard-remote/versions/<version>/` | One Whiteboard version: the package, its dependencies, a `whiteboard` launcher and a marker file that records what was checked. |
| `~/.dev/whiteboard-remote/node/v<node version>/` | Node 24, only when the host has none. |
| `~/.dev/whiteboard-remote/install.lock/` | Present while an install runs. |
| `~/.local/bin/whiteboard` | A launcher for the newest version, so that you and your agents can run `whiteboard` there. Desktop writes it only if that path is free or Desktop's own; a `whiteboard` you installed yourself is left alone. |

With `DEV_REVIEW_HOME` set in the remote's environment, `whiteboard-remote/`
is under that directory instead of `~/.dev`, as is everything below that
Desktop and the VS Code server keep there.

As before, the review server keeps its reviews in `~/.dev`
(`review-api.db` and its companion files).

### Updates

When Desktop updates, it installs its new version beside the old one without
asking again, and restarts the review server it started on the new version.
Your reviews stay. Desktop keeps two versions on a host, and any older one
that a running process still uses; it removes the rest after the next
install. If the new version fails to install but a `whiteboard` of that version
on `PATH` attaches, the host is `online` and Settings does not show the
failure; the next connection tries the install again.

Desktop does not stop a review server that you started yourself
(`whiteboard server start`). If that server runs another version, the host is
`incompatible` until you stop it. A newer server, started by a newer Desktop,
is also left running, and this Desktop asks you to update.

### The setting

`review.remote.install` decides whether Desktop installs on a host that does
not have its version:

| Value | What Desktop does |
|---|---|
| `ask` (the default) | Asks once per host. |
| `always` | Installs without asking. |
| `never` | Never installs. It uses the `whiteboard` you installed on the host's `PATH`, and shows `not-installed` with the command when there is none. |

### Install by hand

With `never`, or after **Don't install**, install the version that matches
your Desktop on the remote yourself:

```sh
npm install -g @dev.fast/whiteboard@<version>
```

This needs Node 24 there. Settings shows the exact command, with the version.
You do not need to start anything: Desktop starts the review server when it
connects. On a remote with no Desktop, `whiteboard api` starts one too, so an
agent there can write reviews before you connect.

### A remote without internet access

It needs nothing more. Desktop uploads Whiteboard and Node from the laptop and
relays npm through the SSH connection.

## Agents on the remote

Once a host is `online`, Desktop looks for coding agents there: Claude Code,
Codex, OpenCode and Pi, by their configuration directories. Looking changes
nothing. Settings lists the agents that are not yet connected to Whiteboard,
with **Connect**, which runs that agent's own install commands on the host,
the same ones `whiteboard connect` gives. An agent whose command is not on the
login shell's `PATH` gets the text to paste into it instead.

**Ask.** Ask works on a review that lives on a host. The agent runs on the
host, in the review's checkout, with the agents and sign-ins already there
(`claude auth login`, `codex login`, `opencode auth login`,
`cursor-agent login`, Pi's `/login`). Threads are kept on the host, so every
laptop that attaches it sees the same history for its reviews. A file that an
answer names shows as text, because Source windows are not available for a
remote review.

## Remove Whiteboard from a host

In Settings, click **Remove** on the host, check **Also remove Whiteboard from
`<alias>`**, and click **Remove host**. Desktop runs the host's own
`whiteboard remote uninstall --keep-reviews` over the connection, which:

- stops the review server that Desktop or the CLI started, and the VS Code
  server and any extension download that `remote attach` started;
- removes `~/.dev/whiteboard-remote/`, and `~/.local/bin/whiteboard` if
  Desktop wrote it;
- keeps your reviews in `~/.dev`.

Desktop also forgets your answer to the install question, so adding the host
again asks again.

It refuses, and removes nothing, while an install runs there, or while a
server you started yourself or another process (such as an agent's MCP
server) runs from the install. Settings shows why; stop that process and try
again. The host is removed from Desktop either way.

On the remote, `whiteboard remote uninstall --keep-reviews` does the same, and
`--delete-reviews` also deletes the saved reviews.

Without the box, **Remove** only takes the host out of Desktop; nothing on the
remote changes, and Desktop keeps your answer.

## States

| State | Meaning | What to do |
|---|---|---|
| `connecting` | Whiteboard is opening the SSH connection and starting the review server. | Wait. |
| `installing` | Desktop is installing its version there; the detail names the step. | Wait. |
| `online` | Connected. The host's reviews are listed and open. | Nothing. |
| `offline` | The connection is up, but the review server did not answer. Whiteboard checks every 10 seconds, so a host that hangs shows `offline` within about 15 seconds. | It returns by itself when the server answers. After three checks in a row without an answer, Whiteboard attaches again. A hung server then shows `unreachable`, and its detail names `whiteboard server stop`: run it on the host. |
| `unreachable` | `ssh` could not connect, the connection ended, or the review server there did not start (the detail says why). | Whiteboard tries again by itself, waiting 1 to 60 seconds between tries; **Retry** tries now. Check that `ssh <alias>` works in a terminal, or do what the detail says. |
| `auth-failed` | The login was refused, a prompt was cancelled, or the host key did not match. | Fix the login, then click **Retry**. Whiteboard does not retry this by itself. |
| `not-installed` | You declined the install, `review.remote.install` is `never` and `whiteboard` was not found, or an install failed (the detail says where). | After **Don't install**, click **Install**; otherwise install by hand with the command that Settings shows and click **Retry**. Whiteboard does not retry this by itself. |
| `unsupported` | Whiteboard cannot run on this machine; the detail says why. Nothing was written there. | Use another machine. |
| `incompatible` | The remote runs another version of Whiteboard: a server you started yourself, a newer one started by a newer Desktop, or a version you installed by hand. | Stop your server (`whiteboard server stop`) and click **Retry**, update this Desktop, or install the version that Settings shows. |
| `duplicate` | Two hosts report the same server id. This happens when a review store was copied to a second machine. | If both aliases are one machine, remove one of them. If they are two machines, remove the copy's host, run `whiteboard server stop` and then `whiteboard server reset-id` on the copy, and add it again. |

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

## Not available for remote reviews yet

- Source windows: "Open file" and the source tree are hidden.
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
