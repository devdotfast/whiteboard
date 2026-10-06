# End-to-end journeys

Each journey in `journeys/` launches Whiteboard Desktop once against
an isolated review home, profile, remote-debugging port and temp root, and drives
it through the JSON review API, the installed `whiteboard` CLI and Playwright over
CDP. Run `telemetry-contract` alone with
`pnpm --filter @dev.fast/review-desktop test:e2e:telemetry`.
`../e2e-runner.test.mjs` checks every journey exports `name`, `phase` and `run`.

## Prerequisites

macOS or Linux, Node 24, an installed workspace (`shared-review` seeds its
fixture with `tsx` from `packages/review`), and a built Desktop from
`pnpm --filter @dev.fast/review-desktop app:build`. `go` and `cargo` are needed
only for the phase-2 journeys.

## Staging the runtime

`--runtime` must name a production install of the CLI, not this checkout:

```sh
pnpm --filter @dev.fast/review-desktop app:build
(cd packages/review && pnpm pack --pack-destination /tmp/review-pack)
mkdir -p /tmp/review-runtime && (cd /tmp/review-runtime && npm init -y >/dev/null && npm install --omit=dev /tmp/review-pack/dev.fast-whiteboard-*.tgz)
export REVIEW_E2E_RUNTIME=/tmp/review-runtime/node_modules/@dev.fast/whiteboard
```

## Running

```sh
node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME"
```

`--journey a,b` selects journeys by name, `--list` prints them without launching
anything, `--keep` keeps the temp root of a journey that passed, and
`--app` runs a packaged build: a macOS `.app`, or the installed executable on
Linux and Windows (pair it with `--runtime` pointing at that install's
`resources/app/review-runtime`). Each journey writes
`report.json`, `app.log` and, on failure, `failure.png` and `failure-dom.txt`
under `/tmp/review-e2e-<journey>-*` on macOS or `$TMPDIR/...` elsewhere. The run
prints a JSON summary on stdout, one entry per journey, `ok | failed | skipped`.

## Phases

Phase 1 runs offline, after a one-time network fetch of the curated VSIX cache
that `lsp-python` triggers. Phase 2 (`lsp-go`, `lsp-rust`, `remote-host`, `remote-lsp`, `remote-install`)
downloads toolchains or a container image and runs only with
`REVIEW_E2E_NETWORK=1` or when named with `--journey`. A journey that exports
`manual = true` (`remote-lsp-rust`, `remote-lsp-swift`, `remote-lsp-csharp`,
whose container images are large) runs only when named. In development mode each journey
re-materializes its extension group through `run.sh`, so this checkout's
`code-oss/extensions` holds the last journey's selection afterwards;
`node scripts/curated-extensions.mjs --only=all` restores it.

## Adding a journey

A journey module exports `name` (matching its basename), `phase`, `options`
passed to `createHarness`, and `run(ctx)`. Useful `ctx` helpers: `until` for
polling, `api` and `apiOk` for the JSON review API, `cli` and `cliRaw` for the
installed CLI, `appLog` for the Desktop's output so far, `launchLog` for the
current launch's output only, `check` to record what the journey proved, plus
`knownBug`, `restartDesktop` (`{ signal: "SIGKILL" }` for a crash),
`quitAndRelaunchDesktop` (a real quit through the workbench), `createReview`,
`openHome` and `pickReview`. Throw `Error("skip: ...")` when the machine cannot
run the journey.

## Known bugs

Product bugs the suite finds live in `KNOWN_BUGS.md` beside this file. Never
weaken an assertion for one: assert the real behaviour, corroborate the bug's own
signature, then call `ctx.knownBug("<heading>")`. The harness fails the journey
when that heading is not in `KNOWN_BUGS.md`.

## Remote hosts

`remote/remote.mjs` gives a live check a real SSH server: a Docker container
(`up`) or an AWS instance (`aws-up`). Each run keeps its key pair,
`ssh_config`, `known_hosts` and `state.json` in `/tmp/wbt.<run id>/`. Nothing
reads or writes `~/.ssh`. Run `remote.mjs` with no arguments for its commands
and options. Its own test creates a container only with `WB_TEST_CONTAINERS=1`.

```sh
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
export WB_TEST_RUN=task0-$$  # before the first `up`, when more than one check may run
trap '$R down --all; $R verify-clean' EXIT
$R up a                      # prints wb-test-a
$R install a
$R ssh a -- whiteboard version
port=$($R forward a 8000)    # ssh -L from a free loopback port
$R logs a                    # the container's sshd log
ssh -F /tmp/wbt.$WB_TEST_RUN/ssh_config wb-test-a
```

Every container, image, network, key pair, security group and instance is
named `wb-test-...`; AWS resources also carry the tags `wb-test=1` and
`wb-test-run=<run id>`. Without `WB_TEST_RUN`, a command uses the only run
there is and says so, so set `WB_TEST_RUN` before the first `up` when more
than one check may run. `down --all` removes the selected run, `down <name>`
one host, and `down --every-run` every run under `/tmp/wbt.*`, to recover
after a crash.
`verify-clean` looks for leftovers by name and tag, not through `state.json`,
and fails when AWS cannot be checked. `aws-up` needs a valid
`aws sso login` session, launches at most two instances at a time in the
profile's default region, and each instance terminates itself after three
hours.

`--sealed` deletes the container's default route and checks that an outbound
request fails; `install` gives the route back only while `npm` runs, then
checks again. `--delay-ms` delays both directions with `netem`. Both run their
network commands from a throwaway container, so the remote itself never holds
`NET_ADMIN`.

## The remote-host journey

`remote-host` runs the review server on another machine: a container from
`remote.mjs` with `sshd` on a loopback port and the package from this checkout.
It needs Docker; without it the journey is skipped with
`skip: remote-host needs Docker for its SSH server`. The Desktop gets
`DEV_FAST_REVIEW_SSH_CONFIG`, so its `ssh` uses the run's configuration and
key, and the journey adds `wb-test-a` in Settings as a user would. It checks,
on the DOM and on the page's requests: the host goes `online`; Home lists the
container's review as `wb-test-a: wbrepo`; the document, a code peek, the Diff
view and the structural diff load; an edit and a `session_create` on the
remote reach the window; a killed `ssh` master shows a chip in the top bar and
recovers without a reload; a stopped server is `offline` within 15 s while a
laptop review still opens; another package version is `incompatible` with the
install command in Settings; and removing the host takes its reviews out of
Home. Throughout, no Desktop route fails, and no request from the window goes
anywhere but the local server or carries the remote's token.

It runs in development mode only: a packaged build ignores
`DEV_FAST_REVIEW_SSH_CONFIG`, so with `--app` the journey is skipped.

To run it against a host you prepared yourself, such as an AWS instance with
the package installed by hand, set `REVIEW_E2E_REMOTE_HOST` to the host's name
in the `WB_TEST_RUN` run. The journey then skips the Docker check, `up` and
`install`, and step 8, which would replace the package. It never removes that
run: it quits the Desktop and ends the Desktop's `ssh`, and you remove the run.

```sh
export WB_TEST_RUN=aws-$$
$R aws-up b --arch arm64     # prints wb-test-b; install the package there by hand
REVIEW_E2E_REMOTE_HOST=b node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-host
$R down --all; $R verify-clean
```

Otherwise the journey removes its run with `down --all` when it ends. A runner killed
before that leaves the run behind, so name the run and trap it:

```sh
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
export WB_TEST_RUN=e2e-$$
trap '$R down --all; $R verify-clean' EXIT
node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-host
```

## The remote-lsp journey

`remote-lsp` checks language features for remote reviews: a laptop and two
containers (`wb-test-a`, `wb-test-b`) in one window. `a.ts` exports `answer`
as `1`, `42` and `99` at the same path, `/tmp/wbt.<run>/proj`, on each
machine, and a hover in each review's Diff tab must show that machine's
number. In order, it checks:

1. both hosts report language features available;
2. four reviews are open at once;
3. hovers and go to definition answer from their own machine;
4. a Python hover from ty works on A;
5. the laptop's own providers are unchanged;
6. A and the laptop keep answering while B is frozen and its ssh master killed
   for longer than its reconnection grace, and B answers again after, without
   a reload;
7. B answers again after its VS Code server is killed;
8. B with another commit reads normally, has no hovers, and Settings says why;
9. after two reloads each remote has one extension host, and none after the
   close;
10. times and memory, failing a first hover over 10 s or a warm one over
    500 ms.

Before running it, build the Desktop and the remote runtime from this
checkout, and stage the runtime as above:

```sh
REVIEW_DESKTOP_DEV_FAST=1 DEV_REVIEW_EXTENSIONS=none pnpm desktop:build
node apps/review-desktop/scripts/build-remote-runtime.mjs
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
export WB_TEST_RUN=e2e-$$ DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1
trap '$R down --all; $R verify-clean' EXIT
node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-lsp
```

Like `remote-host`, it needs Docker and runs in development mode only. The
containers download the language extensions from Open VSX. For the
commit check, the journey writes `code-oss/product.overrides.json` with the
remote runtime's commit and removes it when the run ends; it refuses to run
over a different one. Each check is printed on stderr as it passes.

Two development-only variables, set in the environment of `whiteboard remote
attach` on a remote, change only that remote's VS Code server:

- `DEV_FAST_REVIEW_REMOTE_SHUTDOWN_WITHOUT_DELAY=1` makes it exit as soon as the last window leaves, not 5 minutes later.
- `DEV_FAST_REVIEW_REMOTE_RECONNECTION_GRACE_SECONDS=<1–9999>` replaces its 10-minute reconnection grace; the journey gives B 20 s for step 6.

Against two hosts you prepared, such as AWS instances, set
`REVIEW_E2E_REMOTE_HOSTS` to their two names in the `WB_TEST_RUN` run. Install
Node 24 and the package on each by hand, from `$R pack --out <file.tgz>`. The
journey then skips `up` and `install` and the package swap (step 8). It
freezes B with `kill -STOP` on its servers, and it leaves the run for you to
remove:

```sh
export WB_TEST_RUN=aws-$$
$R aws-up a --arch x64; $R aws-up b --arch arm64
$R pack --out /tmp/wb.tgz    # then, on each host: Node 24, `sudo npm install -g` the tarball
REVIEW_E2E_REMOTE_HOSTS=a,b node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-lsp
$R down --all; $R verify-clean
```

## The remote-lsp-rust, -swift and -csharp journeys

Each checks one optional language group on a container built from the
toolchain's official image (`remote.mjs up --toolchain rust|swift|dotnet`),
with the toolchain on the login shell's `PATH` only for Rust and .NET:

1. the toolchain is found by a login shell;
2. the group is turned on in the Desktop's extension picker;
3. a review of the fixture from `fixtures/lsp/<language>` on the remote;
4. the host added in Settings: language features available, the row lists the
   group as installed, and the remote installed that group and no other
   optional group (Rust: the server binary runs);
5. Swift only: a second host, `wb-test-d`, without Swift, attaches, and its
   Settings row names the missing `swift`; Swift and C# stop here: they do
   not answer hovers yet (`docs/remote-hosts.md`);
6. a pointer hover shows the type, within 120 s of the Diff click;
7. go to definition opens the remote's file, read-only;
8. the extension host's `PATH` holds the toolchain, no debugger runs, and the
   remote's memory;
9. no extension host is left after the window closes.

Build and stage as for `remote-lsp`, then run one by name. Set
`REVIEW_E2E_REMOTE_PLATFORM=linux/amd64` for an x64 container. On failure the
journey prints the remote's processes and extension logs.

```sh
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
export WB_TEST_RUN=e2e-$$ DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1
trap '$R down --all; $R verify-clean' EXIT
node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-lsp-rust
```

The base images stay in Docker after `down`; remove them with `docker rmi`
when done (`rust:1.98-bookworm`, `swift:6.4-noble`,
`mcr.microsoft.com/dotnet/sdk:10.0-noble`).

## The remote-install journey

`remote-install` proves that Desktop installs itself on a remote: it brings up
containers with nothing of Whiteboard on them, adds each one in Settings,
answers the install question in the window, and checks each host over SSH.
Like `remote-host`, it needs Docker, runs in development mode only, and
removes its run with `down --all` when it ends.

| Container | `up` flags | What it proves |
|---|---|---|
| `fresh` | `--platform linux/amd64 --node none` | The first install, x64 target: the question, each step in Settings, `online`, and a review written there with `~/.local/bin/whiteboard` listed in Home. Later: the next version, Connect for an agent, and removal with "Also remove Whiteboard". |
| `node` | `--node 24` | The host's own Node runs Whiteboard; no `~/.dev/whiteboard-remote/node`. Later: a server the user started at the old version makes the newer Desktop `incompatible`, and keeps running. |
| `sealed` | `--sealed --node none` | No route out: Node and the package are uploaded, npm goes through Desktop's relay. |
| `old` | `--image debian:11 --node none` | glibc 2.31: `unsupported`, no question, nothing written in the home. |
| `arm` | `--platform linux/arm64 --node none` | The ARM64 target. |
| `fresh2` | `--platform linux/amd64 --node none` | The ssh master killed during the package step: the reconnect finishes the install, with no `.part` left. |
| `deny` | `--node none` | "Don't install": `not-installed` with the npm command, nothing written, and no second question after Retry. |

On an Apple-silicon Mac the containers without `--platform` are ARM64 too,
and `fresh` and `fresh2` run under emulation; elsewhere, swap the two
`--platform` values if the emulated one is too slow.

For "the next version" the journey raises the patch version in
`packages/review/package.json`, which the Desktop's server reports and its
development pack carries, restarts the Desktop, and writes the file back when
it ends. Do not run it while you edit that file. Run it under a trap that also
restores the file, in case the runner is killed:

```sh
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
export WB_TEST_RUN=e2e-$$
trap '$R down --all; $R verify-clean; git checkout -- packages/review/package.json' EXIT
DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1 node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-install
```

The connect step installs Claude Code from npm on `fresh`, and needs GitHub
there for its plugin, so the journey needs the network throughout. It
prints the time from **Install** to `online` for each host in its checks.

### On AWS

With `REVIEW_E2E_REMOTE_HOSTS`, a comma-separated list of host names in the
`WB_TEST_RUN` run, the journey uses hosts you brought up with `aws-up` and
did not touch: for each one it checks that nothing of Whiteboard is there,
adds it, answers Install, waits for `online`, and lists a review written
there in Home, reporting the time from Install to `online`. It runs no
container step and never removes the run. `aws-up` keeps at most two
instances at a time, so run the sealed host on its own:

```sh
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
export WB_TEST_RUN=aws-$$
trap '$R down --all; $R verify-clean' EXIT
$R aws-up a --arch x64
$R aws-up b --arch arm64
REVIEW_E2E_REMOTE_HOSTS=a,b DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1 \
  node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-install
$R down a; $R down b
$R aws-up c --sealed
REVIEW_E2E_REMOTE_HOSTS=c DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1 \
  node apps/review-desktop/scripts/e2e/run.mjs --runtime "$REVIEW_E2E_RUNTIME" --journey remote-install
```
