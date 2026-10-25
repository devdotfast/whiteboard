# Review Desktop

Review Desktop is the global Progressive Review UI. It uses a pinned Code OSS
fork for editor and language services. The fork is tracked in `code-oss/`, and
Review-owned workbench code lives directly in `code-oss/src/vs/review/`. See
[`UPSTREAM`](UPSTREAM) for provenance and the complete divergence inventory.

One desktop window owns one embedded global server. The app opens on Home with
no repository. It opens pinned review worktrees only when a review needs them.
Home scans `${DEV_REVIEW_HOME:-~/.dev}/reviews/*/review.json`; opening a review
creates an in-memory active session rooted at that review's repository.
Session URLs are routes on that global server; session-scoped
document caches, file watchers, and event clients do not bind their own ports
or create additional HTTP servers.

## Build and run

### Prerequisites

- Node for the monorepo: the version in the root `.nvmrc`.
- Node for the Code OSS fork: the exact version in `code-oss/.nvmrc`.
  Install `fnm` or `nvm` so the build scripts can switch automatically.
- pnpm: the version in the root `package.json` `packageManager` field.
- Python 3 and a C/C++ toolchain (Xcode Command Line Tools on macOS) for
  native module builds.
- On Linux: `libx11-dev libxkbfile-dev libkrb5-dev libsecret-1-dev`.
- `zstd` (only for the release payload handoff).

From the monorepo root:

```sh
pnpm install
pnpm desktop:build
pnpm desktop:run
```

### Fast development builds

`pnpm dev` sets `REVIEW_DESKTOP_DEV_FAST=1` for the build step. This mode
skips current Code OSS client and extension outputs. A stale client uses the
esbuild `transpile-client` path without a typecheck. A stale extension build
uses the existing Gulp extension tasks.

The freshness stamps are under `code-oss/.build/dev-fast`. The checks include
source files, source directories, build tools, and the dependency digest.
`run.sh` continues to build the Review server and canvas when they are stale.

Run `pnpm desktop:build` without the flag for a full compile and typecheck.

### Launching without taking focus

`pnpm dev:background` builds and launches the Desktop without bringing its
window forward, the same way `whiteboard app launch` does without `--focus`. It
sets `DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1`, which `run.sh` passes through to
the Electron process; set it yourself for a bare `pnpm desktop:run`. The
window stays behind whatever is frontmost until you click it or run
`whiteboard app launch --focus`. Computer-use and other screen-driven tests rely
on this so the terminal that started the app keeps focus.

To reset generated Code OSS artifacts and the local Desktop profile, run this
from the monorepo root:

```sh
pnpm clean
```

This does not remove authored reviews in `${DEV_REVIEW_HOME:-~/.dev}/reviews`.

`desktop:run` takes no repository argument. Global user data and discovery live
under `${DEV_REVIEW_HOME:-~/.dev}/review-desktop/`; discovery is the private,
atomic `server.json`, and Code OSS profile state is under `state/`.

The released macOS app uses `whiteboard app launch` as its command-line entry.
The app-managed CLI removes `ELECTRON_RUN_AS_NODE` and starts its exact
`process.execPath`. Thus, the app can live outside `/Applications`. A
repository or standalone CLI asks macOS to open bundle identifier
`dev.fast.review`. The command checks `/health` for the matching instance and
an attached Desktop client before it reports readiness.
Tests can set `DEV_FAST_REVIEW_DESKTOP_STATE_ROOT` to keep the Code OSS profile
under an isolated directory.

Run `whiteboard app pick [--review <uuid>]` to select a review. Bare `whiteboard app`
starts the app. `whiteboard info` does not start it.

Home lists review descriptors derived from `review.json`. Missing worktrees or
documents remain visible but disabled. Reopening creates a desktop-owned active
session; candidates never appear on Home.

### Legacy review import

Reviews published from MDX before this release were imported into the JSON
review store when Home lists them or when they are opened. A review is
imported once its uuid has a row in the store: Home then shows only the JSON
entry, and opening routes to the JSON canvas. Every sealed revision becomes a
store version. Nothing is written back into the legacy review directory. A
review whose repository is no longer on this machine stays legacy.

### End-to-end checks

The manual end-to-end journeys live in `scripts/e2e/`; each one drives the
built Desktop through the installed CLI and the JSON review API. See
`scripts/e2e/TESTING.md` for how to stage a runtime and run them.

### Remote hosts

A development Desktop pins no archive. Set `DEV_FAST_REVIEW_REMOTE_RELEASES` to
a URL serving the archives and their `.sha256` files, or install this
checkout's archive with
`node apps/review-desktop/scripts/remote-dev-install.mjs <alias>`. With
`DEV_FAST_REVIEW_REMOTE_PUBLISH=1` and Cloudflare credentials, the script
publishes the archives and prints the URL to export.

How remote hosts work (the user guide is `docs/remote-hosts.md`):

#### Connection

On macOS and Linux, Desktop opens one SSH master connection per host
(`ControlMaster`) and runs every command and port forward over it. On Windows,
which has no `ControlMaster`, a master connection serves a loopback SOCKS port
for forwards, and each command opens its own `BatchMode` connection.

The remote review server listens only on the remote's loopback interface.
Desktop's local review server reaches it through an SSH port forward and acts
as a gateway: the canvas talks only to the local server, which proxies remote
reviews with the remote server's token. Language features use a second
forward, to a VS Code server also on loopback.

#### Install and updates

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

#### Language features

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

#### Source windows

"Open file", the source tree and Ask's file links open a read-only Source
window on the host, with search and language features. Each window runs its
own extension host on the host; close ones you are done with. When the host
stops answering, the status bar offers Retry and the window reconnects when
the host is back.

Source windows have no terminals or source control. On musl hosts such as
Alpine, the explorer refreshes on focus instead of live.

#### Ask

Ask threads are kept on the host, so every laptop connected to it sees the
same history.

## Packaging and releases

macOS (arm64 and x64) is the only packaged platform with release channels;
Linux has a packaging script but no distribution. Signed builds auto-update
from `https://update.dev.fast` on either the `stable` or `preview` channel.

### Local packaging

```sh
SKIP_NOTARIZE=1 pnpm --filter @dev.fast/review-desktop app:package:macos
```

builds an unsigned `VSCode-darwin-<arch>/Whiteboard.app` for the host arch and skips
signing, notarization, and artifact creation. A full run needs the signing
environment and produces the `.dmg` plus one Squirrel update zip per installed
bundle folder name (`Whiteboard-…zip`, `Review-…zip`; see `release-channel.mjs`),
all notarized and stapled:

- `CODESIGN_IDENTITY` — the Developer ID Application identity string.
- Keychain: `CODESIGN_KEYCHAIN` (explicit path), or `AGENT_TEMPDIRECTORY`
  pointing at a directory containing `buildagent.keychain` (the CI shape);
  leave both unset to use the login keychain.
- Notarization, first match wins: `NOTARY_KEYCHAIN_PROFILE` naming a stored
  `notarytool` profile (preferred locally — no credentials in the
  environment); `APPLE_API_KEY_PATH` + `APPLE_API_KEY_ID` +
  `APPLE_API_ISSUER_ID` for an App Store Connect team key (what CI sets); or
  `APPLE_ID` + `APPLE_TEAM_ID` + `APPLE_ID_PASSWORD`.

### Cutting a release

Run the **Review Desktop Release** workflow from the Actions tab (or
`gh workflow run review-desktop-release.yml -f bump=patch`) with a
patch/minor/major bump. The workflow:

1. bumps `apps/review-desktop/package.json`, commits `[skip ci]`, tags
   `vX.Y.Z`, and creates a draft GitHub release;
2. compiles the platform-independent Code OSS, Review canvas, Review server,
   workspace packages, and pinned `darwin-arm64` and `darwin-x64` curated
   extensions on Linux, then uploads a `darwin-payload` artifact per arch;
3. extracts that payload on `macos-15-xlarge` (`darwin-arm64`) or
   `macos-15-large` (`darwin-x64`), performs only the native Darwin
   package assembly, stages the runtime, tools, and extensions, then signs and
   notarizes via `app:package:macos`;
4. gates the upload with `scripts/validate-release-artifacts.mjs` (curated
   extension closure, staple and Gatekeeper checks, and packaged `product.json`
   commit/quality/updateUrl assertions), which also emits the `latest.json`
   feed manifest for that arch;
5. once both legs pass, a `publish` job per arch uploads its zip and dmg
   payloads first, then its `latest.json` feed and dmg alias, so a client can
   never see a manifest whose payload is missing;
6. curls that arch's live feed to confirm the new release is served, attaches
   the dmg to the GitHub release, and publishes it.

Each platform publishes as soon as its own build passes; one failing platform
does not hold back the others. Latest aliases and feeds only move forward
(`scripts/promote-release-aliases.mjs`; Linux's pointer has the same rule), so
publishing an older version uploads its files and leaves latest alone. The
first platform to publish takes the GitHub release out of draft. Platform
builds start with the remote tarball job and wait for its pin artifact only
before packaging (`scripts/wait-for-run-artifact.mjs`).

To retry a platform that failed, use **Re-run failed jobs** on the run. To
build it again later for the same version, start a new run with that version's
tag and only that platform:

```sh
gh workflow run review-desktop-release.yml -f version=v0.2.4 -f platforms=windows
gh workflow run review-desktop-preview.yml -f version=v0.2.5-preview.20261015.117 -f platforms=windows
```

A backfill builds the tagged commit, reuses the published remote tarballs, and
makes no version bump, tag, or new GitHub release. Linux packages are not
byte-for-byte reproducible, so a Linux publish that failed partway is recovered
by re-running its failed jobs, not by a backfill.

The `platforms` input picks `all` (the default), `macos-arm64`, `macos-x64`,
`linux` or `windows`. The two Mac arches build, publish and backfill on their own.
Windows builds in parallel with the Darwin payload and the Linux packages
(`review-windows-build.yml` on the 16-core `review_big_boy_windows` runner) and
signs every binary and installer with Azure Artifact Signing through the
`windows-signing` environment. Its `publish` job then uploads the installers
to `releases/<version>/win32-x64/`, points `install.dev.fast/windows` at the new
per-user installer, updates the Windows update feeds, and attaches the
installers to the GitHub release.

### Promoting a preview to stable

A preview that has been running well can be released as the stable build
instead of cutting a fresh one from whatever `main` now holds:

```sh
gh workflow run review-desktop-preview.yml -f ref=main
# ...then, with the tag that run pushed:
gh workflow run review-desktop-release.yml \
  -f bump=patch -f release_source=preview \
  -f preview_tag=v0.0.32-preview.20260907.7
```

`release_source: preview` requires `preview_tag` and accepts only a `patch`
bump. The tag needs to be on `main`, but **not** at its tip: whatever merged
after the preview published stays out of the release, because a promotion ships
the commit that was actually tested. The stable version comes from the tag
(`v0.0.32` above) and must be the next patch, which is what rejects a preview
that predates another release — publish a new one in that case.

So `vX.Y.Z` marks the commit that shipped, which for a promotion is behind
`main` by however much landed in the meantime. `main` still gets its
`chore(review-desktop): bump version` commit, because the next release derives
its version from there; that commit is bookkeeping, not the released tree.
Checking out `vX.Y.Z` therefore gives you the released source with the previous
version still in `package.json` — the build stamps the release version in, the
same way a preview build stamps its own.

Promotion rebuilds from source. Preview and stable are different applications —
separate bundle identifier, application name, data folders, URL scheme, and
update feed — so the stable run stamps stable identity onto that commit and
takes the same build, sign, notarize, upload, and publish path as any release.
No preview binary is relabelled.

A dry run makes no remote change, and builds the same commit under the same
stamp a real promotion would.

### Preview builds

Run the **Review Desktop Preview** workflow from `main`, and pass the branch,
tag, or commit to build as its `ref` input:

```sh
gh workflow run review-desktop-preview.yml -f ref=<branch>
```

The workflow makes no commit and no GitHub release. It stamps the working
tree with the next patch version plus
`-preview.<yyyymmdd>.<run-number>`, then publishes only to preview R2 keys.
Once the version is computed, it pushes a lightweight `v<version>` tag at the
commit it builds — but only when that commit is on `main`, since a branch that
never landed cannot be promoted. The tag names the build, not a set of
published platforms.
That tag is what "Promoting a preview to stable" above takes as its
`preview_tag`, and it stays promotable as `main` moves on.
The ref must include the preview tooling, so branch it from a `main` that
already contains this workflow and its scripts. Updates are keyed by commit;
publishing an older commit intentionally rolls preview installations back to
that build.

Install the latest preview from <https://install.dev.fast/preview>. It installs
as `Whiteboard Preview.app`, displays as `/dev/fast Whiteboard Preview`, and uses an
orange app-icon background so it stays visually distinct from stable in Finder,
the Dock, and the app switcher.

Preview uses its own bundle identifier, URL scheme, CLI name, and data folders,
so it can run beside stable without replacing the stable app or sharing its
settings. Preview updates continue to use the preview feed. To return to stable,
open the existing `Whiteboard.app` or install it from <https://install.dev.fast>.
Squirrel renames an install to the update's executable name, so the client
sends its own bundle name (`?bundle=`) and the feed answers with a zip whose
bundle and executable carry that name (the Review copy is re-signed and
notarized on its own): `Review.app` installs stay `Review.app`, fresh installs
are `Whiteboard.app`.

Builds from before the preview identity split installed as `Review.app`.
Reinstall once from <https://install.dev.fast/preview> after the split so the
preview lands at the new application path; later preview updates retain it.

### Linux-to-macOS build handoff

The release is a split build. Linux is not only a cache warmer: it is the
authoritative producer for everything that does not require a Darwin host.
`scripts/compile-darwin-payload.sh` creates one archive for both Darwin
targets, and `REVIEW_DESKTOP_PRECOMPILED=1 scripts/package-macos.sh` consumes it
on each macOS build leg (`darwin-arm64` and `darwin-x64`), packaging the target
of the host it runs on.

| Produced on Linux and transferred                                                                        | Produced or assembled on macOS                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Code OSS `out-build`, `out-vscode-min`, and `out`                                                        | Electron application bundle                            |
| Compiled built-in extensions in `.build/extensions`                                                      | Darwin-native npm closure installed by `pnpm`          |
| Manifest-selected `darwin-arm64` and `darwin-x64` VSIX payloads, including `ty` and rust-analyzer       | Manifest-selected extensions copied into the final app |
| Review canvas/server and required workspace `dist` directories                                           | App icon, signatures, notarization, ZIP, and DMG       |

The curated-extension handoff is manifest-driven. Linux materializes the
variants for every Darwin target, copies each into
`.build/review-curated-extensions/<target>`, and includes those directories in
the archive. Each macOS leg requires every target's directory before packaging,
then verifies every manifest entry for its own target while copying that
directory into the app. Release validation verifies the same complete set again
after notarization and before upload.

`scripts/darwin-payload-manifest.sh` is the source of truth for archive paths.
Its required paths must exist before macOS packaging starts. Its archive-only
paths are build intermediates that Gulp consumes without a direct wrapper check.

When a new packaged artifact bypasses the normal Gulp output, update all four
parts of the contract in the same change:

1. produce it in `build.sh` or `compile-darwin-payload.sh`;
2. add its repo-relative path to the required or archive-only manifest list;
3. stage required app content in `package-macos.sh` before signing;
4. assert it through an existing manifest-driven verifier or
   `packaged-runtime.test.mjs`, and repeat critical closure checks in
   `validate-release-artifacts.mjs` before upload.

### Install and update hosts

The update Worker serves both `install.dev.fast` and `update.dev.fast`
in front of a private R2 bucket. The routes are
disjoint, so both hostnames answer all of them and the Worker needs no
host discrimination; the two names exist to give humans and Squirrel separate
front doors.

`GET /` is the stable install landing: it redirects to the
`releases/latest/darwin-arm64/Whiteboard.dmg` alias, while `GET /preview` redirects
to `releases/preview-latest/darwin-arm64/Whiteboard.dmg`. Browsers go to
<https://dev.fast/install> or <https://dev.fast/install/preview> instead. For example,
`curl -fLOJ https://install.dev.fast` downloads the current disk image. It
deliberately does not read `latest.json` — the alias is uploaded with the
payloads, so the download keeps working while the manifest is mid-upload. The
keys stay version-free for that reason, so the version rides on each object's
`Content-Disposition` instead and the saved file names itself. Stable uses
`df-whiteboard-<version>.dmg`; preview uses
`df-whiteboard-preview-<preview-version>.dmg`. curl only honours that with `-J`; a
browser download always does.

Homebrew casks (`devdotfast/tap/whiteboard`, `whiteboard@preview`) install the
same versioned zips. The tap's hourly workflow bumps them from the update feed.

```
update/stable/<target>/latest.json        current-release manifest
update/preview/<target>/latest.json       current-preview manifest
releases/<version>/<target>/              Whiteboard-<target>-<version>.zip + .dmg
                                          Review-<target>-<version>.zip (Review.app-named copy)
releases/latest/<target>/Whiteboard.dmg
                                          direct-download alias, saved as
                                          df-whiteboard-<version>.dmg
releases/preview-latest/<target>/Whiteboard.dmg
                                          preview-download alias, saved as
                                          df-whiteboard-preview-<preview-version>.dmg
```

`<target>` is `darwin-arm64` or `darwin-x64`; every key exists for both.

`GET /api/update/:platform/:quality/:commit` answers 204 when the caller's
stamped commit matches the manifest (or no manifest exists yet) and Squirrel
JSON otherwise; `GET /releases/*` streams payloads. Intel clients request the
plain `darwin` platform, which the Worker maps to `darwin-x64`. Because the feed keys its
answer off the caller's commit, the fork's `doDownloadUpdate` sends the
installed commit — not the target commit — when re-checking (see `UPSTREAM`).

### CI credentials

Repository secrets: `APPLE_CERT_BASE64`, `APPLE_CERT_PASSWORD`,
`APPLE_KEYCHAIN_PASSWORD`, `APPLE_API_KEY_P8`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `POSTHOG_CLI_API_KEY` (a PostHog personal API key
with the error tracking write scope). Repository variables:
`APPLE_SIGN_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER_ID`, `R2_ENDPOINT_URL`, `R2_RELEASE_BUCKET`,
`REVIEW_POSTHOG_KEY` (telemetry key embedded into release builds; source
builds embed none), `POSTHOG_CLI_PROJECT_ID` (the PostHog project that
receives the source maps), and `SKIP_NOTARIZE` (normally unset; set to `1`
only to dry-run the workflow without signing).

A build that embeds `REVIEW_POSTHOG_KEY` also uploads its source maps to
PostHog error tracking (`scripts/upload-source-maps.mjs`), so reported stack
traces resolve to source files and functions. That build fails when the two
`POSTHOG_CLI_*` credentials are missing.

Normal CI uses GitHub's standard Ubuntu runner. Windows builds, in CI and in
releases, use the `review_big_boy_windows` larger runner in the `review_windows`
runner group, which only this repository can use; pull requests from forks skip
them. The manual release workflow uses the `review_big_boy` larger runner. Its `review_release` runner group
allows `review-desktop-release.yml` and `review-desktop-preview.yml` from
`main`. The first stable or preview job also uses the `review-release`
environment, which requires repository-admin approval before downstream jobs
can use the release infrastructure. Adding the preview workflow requires a
repository admin to add `review-desktop-preview.yml @ main` to that runner
group's allowed-workflows list.

## Curated extensions

Review has a fixed extension catalog and no marketplace. Each VSIX has an exact
version, target, size, and SHA-256 hash in
`scripts/curated-extensions.manifest.mjs`. Nothing binary is committed.

### Bundled extensions

The build fetches bundled extensions from Open VSX. It checks each hash and
unpacks the extension into `code-oss/extensions/`.

| Extension  | Notes                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| ty         | Bundles its own server                                                                       |
| Go         | Bundles nothing and prompts to `go install gopls` against your own Go toolchain              |
| Vim, Emacs | Adopted from the host VS Code install on first launch; otherwise off, and mutually exclusive |

### Optional extensions

Review downloads an optional group only after the user selects it in
**Manage Extensions...**. Review checks the downloaded VSIX before installation.
The application reloads once after a successful change.

| Group | Requirements                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------ |
| Rust  | rust-analyzer includes its server. Rust moved from bundled to optional.                                |
| Swift | Install a Swift toolchain and expose `swift` on the shell `PATH`. The group includes LLDB DAP support. |
| C#    | Install a system .NET SDK and expose `dotnet` on the shell `PATH`. Review does not download .NET.      |

Review updates installed optional groups to the catalog pins in the background.
The update does not reload the window. A new pin takes effect on the next reload.

Install, enable, or disable them with **Manage Extensions...** from the command palette,
or from **Settings...** (⌘,). The choice persists per profile and
reloads the window, since extension enablement only applies when the extension
host restarts.

## Settings

**Settings...** (⌘,) opens the Settings tab. It is a canvas tab
like Home and Agent Setup, not the stock VS Code settings editor. It holds:

| Section               | Setting                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| Privacy               | Share anonymous usage data — see [docs/telemetry.md](../../docs/telemetry.md) |
| Editor                | Theme, Keymap                                                                 |
| Tools                 | Extensions                                                                    |
| Experimental Features | Software Map, Trace capture                                                   |

Software Map defaults to off. Enable it to add the Map tab to reviews.
Disable it to remove Map entry points. This preference persists in the
application profile. The change does not require a reload.

Trace capture defaults to off. Enabling capture takes S3/R2 credentials,
installs the agent session hooks and the `trace-archaeology` skill for every
installed agent, and lets reviews quote agent sessions. Disabling removes the hooks and skill again. The state lives
in the review server's machine trace settings, not the application profile.

The application menu is macOS only. On Windows and Linux the same surfaces are
available from the command palette (`review.openSettings`).

## VS Code settings and keybindings

On first launch, Review adopts the default profile from the most recently
modified Code, Code - Insiders, VSCodium, or Cursor installation. It copies
`keybindings.json` byte-for-byte and imports user-facing settings such as
`editor.*`, `vim.*`, `emacs-mcx.*`, `files.*`, themes, and fonts. Review's
hardening, telemetry, update, extension, remote, and trust settings are never
imported.

If the selected install has VSCodeVim or Emacs MCX installed, Review records
`"review.keymap": "vim"` or `"emacs"` and enables the matching curated
extension on its one-time seed reload. **Manage Extensions...** keeps that
setting in sync with the picker.

The import is idempotent: `User/.review-import.json` records the source, and
pre-existing Review `keybindings.json` or `settings.json` files are never
overwritten automatically.
Run **Review: Import VS Code Settings and Keybindings...** from the command
palette for an explicit re-import; Review previews any files it would overwrite
and offers a reload afterward.

Set `DEV_REVIEW_IMPORT_FROM` to a VS Code-family configuration directory (or
its `User` directory) to choose a source. Set it to `none` to disable importing.

`DEV_REVIEW_EXTENSIONS` controls build-time materialization. `all` is the
default and includes only bundled groups. `none` downloads nothing. A
comma-separated list accepts `python,go,vim,emacs,rust,swift,csharp`. An
explicit optional group materializes its pinned VSIX files for development or
packaging checks. It does not install or enable that group for a user.

Language extensions activate when you open a file of that language.

Known limits:

- Only the default VS Code-family profile is imported.
- Imported bindings for commands Review does not register (for example Git,
  terminal, task, or debug commands) remain inert.
- The Review canvas is an iframe, so Vim and Emacs keymaps apply to workbench
  file, diff, and multi-diff editors, not text fields inside the canvas.

## UI controls

Prefer existing VS Code workbench primitives for standard desktop interactions:
`IContextMenuService` for action and selection menus, `IDialogService` for
confirmations and simple prompts, `IQuickInputService` for searchable choices,
`IHoverService` for tooltips, and `INotificationService` for notifications.
Use the host's settings subscriptions for settings state.

Expose the capability through a small typed canvas adapter; keep Code OSS
imports out of the React canvas package. Home and onboarding have no review
session, so they get host UI from the optional UI capability passed to
`mountReviewCanvas`. Reuse the existing `setupTooltip` and `notify` bridges.
Workbench services pick the appropriate platform implementation; they do not
always use OS-native UI.

Keep rich document content, forms, and inline feedback in React. Add another UI
library only for a concrete behavior the existing host or browser primitives
do not cover. Menu controls use the Desktop host service; browser tests inject
a test host instead of maintaining a second production menu implementation.
Check keyboard navigation, cancellation, focus restoration, disposal, themes,
zoom, and narrow layouts in the actual Desktop app when changing a host control;
browser tests alone do not validate the workbench integration.

Canvas data and CSS conventions are in
[`packages/review/app/README.md`](../../packages/review/app/README.md).

## Development and validation

Canvas changes need `pnpm --filter @dev.fast/review-canvas build` and a
window reload. For fork workbench changes, run the incremental compiler in a
separate terminal, edit under `code-oss/src/vs/review/`, then use **Developer:
Reload Window**:

```sh
pnpm desktop:watch
```

The fork's copy of the protocol, `code-oss/src/vs/review/common/reviewProtocol.ts`,
is generated from `packages/review-protocol/src` and is not committed. `app:build`,
`test`, `typecheck`, and `app:watch` regenerate it. The `test` and `typecheck`
tiers also need Code OSS's own npm dependencies installed
(`bash apps/review-desktop/scripts/code-oss-dependencies.sh`), which `app:build`
installs for you. To regenerate by hand:

```sh
pnpm --filter @dev.fast/review-desktop protocol:sync
```

Run Code OSS commands with npm from `code-oss/`, never with the monorepo's
pnpm.

Keep fork divergence enumerable as direct commits above the
`code-oss-upstream-8a7abeba` tag. Every upstream exclusion or intentional edit
must be recorded in `UPSTREAM`, and `src/vs/review/` tests must pass the
fast monorepo tier.

### The main-process pre-bootstrap window

`code-oss/src/main.ts` runs in the Electron main process before anything else.
Its `startup()` calls `bootstrapESM()` — which installs
`globalThis._VSCODE_NLS_MESSAGES` — and only then dynamically imports
`vs/code/electron-main/main.js`. Every _static_ import at the top of `main.ts`,
and everything those pull in transitively, is evaluated before that message
table exists.

In a packaged build the NLS mangler rewrites `localize('someKey', "Text")` into
`localize(2488, null)`, and `vs/nls.ts` throws `!!! NLS MISSING: 2488 !!!` when
index 2488 is absent. Thrown there, Electron shows a modal that blocks the main
thread before any window, renderer, or log file exists: the app never starts and
leaves no trace to debug. **This is invisible from sources** — running from
`out/` keeps NLS keys as strings and `localize` returns the English fallback, so
`pnpm dev` can neither reproduce nor refute it. Review Desktop 0.0.4 shipped
exactly this and could not launch at all.

The usual way in is a configuration registry. Importing
`vs/platform/configuration/common/configurationRegistry.js` is by itself fatal:
it runs `new ConfigurationRegistry()` at module scope, and that constructor
localizes. Deleting the `registerConfiguration` calls from a module while
keeping a value import of `Extensions` or `ConfigurationScope` does not help —
the import edge has to be severed.

So, for anything `src/main.ts` can reach — in practice `vs/review/node/**` and
`vs/review/electron-main/**`:

- Do not import `vs/nls.js`, `vs/platform/registry/common/platform.js`, or
  `vs/platform/configuration/common/configurationRegistry.js`, directly or
  transitively.
- Keep shared data in import-free modules. Setting keys and default values live
  in `vs/review/common/reviewConfigurationDefaults.ts`, which imports nothing;
  `vs/review/common/reviewConfiguration.ts` imports it and owns the registry
  calls. Never re-export the data back through the registration module — that
  would put the registry back on the main process's import path.
- Anything that genuinely needs the registry belongs behind the dynamic import
  in `startup()`, or in the renderer.

`scripts/main-bootstrap-imports.test.mjs` walks the static import graph from
`main.ts` and fails on a violation, printing the offending chain. It runs in the
monorepo test tier and takes about a second, so run it before packaging rather
than discovering this from a dead `.app` bundle.

Signing and notarization say nothing about whether the app runs, so
`scripts/smoke-launch-packaged.mjs` launches the packaged bundle and requires a
renderer process and the embedded Review server ready event to appear. Smoke
failures include the captured main log. The release workflow runs it after
`validate-release-artifacts.mjs` and before the R2 upload. Point it at a local
bundle with `--app` when packaging by hand.

## Linux distribution

Linux x86-64 packaging, repository signing, setup, and release validation are
documented in [the Linux release runbook](scripts/linux/README.md). The native
packages expose `review` as the bundled agent CLI and `review-desktop` as the app
launcher. Updates use DNF; Review links to package-manager instructions. Previews
ship as the separate `dev-fast-review-preview` package (`review-preview`,
`review-preview-desktop`) from their own repository, installable alongside stable.
