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
mkdir -p /tmp/review-runtime && (cd /tmp/review-runtime && npm init -y >/dev/null && npm install --omit=dev /tmp/review-pack/dev.fast-review-*.tgz)
export REVIEW_E2E_RUNTIME=/tmp/review-runtime/node_modules/@dev.fast/review
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
that `lsp-python` triggers. Phase 2 (`lsp-go`, `lsp-rust`) downloads toolchains
and runs only with `REVIEW_E2E_NETWORK=1`. In development mode each journey
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
reads or writes `~/.ssh`. Run `remote.mjs` with no arguments for its commands;
`04-test-environments.md` in the remote-servers plan specifies them.

```sh
R="node apps/review-desktop/scripts/e2e/remote/remote.mjs"
trap '$R down --all; $R verify-clean' EXIT
$R up a                      # prints wb-test-a; the first `up` prints the run id
export WB_TEST_RUN=<run id>  # needed only when several runs exist
$R install a
$R ssh a -- whiteboard version
port=$($R forward a 8000)    # ssh -L from a free loopback port
$R logs a                    # the container's sshd log
ssh -F /tmp/wbt.$WB_TEST_RUN/ssh_config wb-test-a
```

Every container, image, network, key pair, security group and instance is
named `wb-test-...`; AWS resources also carry the tags `wb-test=1` and
`wb-test-run=<run id>`. `down --all` removes every run's resources, or only
`WB_TEST_RUN`'s when it is set, and `down <name>` removes one host.
`verify-clean` looks for leftovers by name and tag, not through `state.json`,
and fails when AWS cannot be checked. `aws-up` needs a valid
`aws sso login` session, launches at most two instances at a time in the
profile's default region, and each instance terminates itself after three
hours.

`--sealed` deletes the container's default route and checks that an outbound
request fails. `--delay-ms` delays both directions with `netem`. Both run their
network commands from a throwaway container, so the remote itself never holds
`NET_ADMIN`.
