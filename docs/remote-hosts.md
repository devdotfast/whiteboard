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
| `offline` | The connection is up, but the review server did not answer. Whiteboard checks every 10 seconds, so a host that hangs shows `offline` within about 15 seconds. | It returns by itself when the server answers. If it stays offline, check the remote's load. |
| `unreachable` | `ssh` could not connect, or the connection ended. | Whiteboard tries again by itself, waiting 1 to 60 seconds between tries; **Retry** tries now. Check that `ssh <alias>` works in a terminal. |
| `auth-failed` | The login was refused, a prompt was cancelled, or the host key did not match. | Fix the login, then click **Retry**. Whiteboard does not retry this by itself. |
| `not-installed` | `whiteboard` was not found on the remote. | Install it with the command that Settings shows, then click **Retry**. Whiteboard does not retry this by itself. |
| `incompatible` | The remote runs another version of Whiteboard. | Run the install command that Settings shows, then `whiteboard server stop` on the remote. Desktop starts the new server within about 10 seconds. |
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

### What an extension on a remote can do

An extension on the remote runs there, like any other process on that
machine. It can read and write the remote's own files. It cannot reach your
laptop:

- It cannot read or change files on the laptop, or on another remote host.
- It cannot open files or links with the laptop's operating system; only
  `http`, `https` and `mailto` links open, in your browser.
- It cannot run the window's commands, except a short fixed list, and cannot
  replace one.
- It cannot read or write the clipboard, change your settings, download to the
  laptop, show a webview, or edit or save documents through the window. The
  code in a review stays read-only in the window.
- It may show notifications, dialogs and prompts, because you act on those
  yourself. Links in them lead only to `http`, `https` and `mailto`.

Each refused action is an error the extension receives.

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
