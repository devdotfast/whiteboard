# Contributing to Whiteboard

Thanks for contributing to Whiteboard. We welcome bug reports, fixes, and new
features. By participating, you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

Open an issue before starting anything significant. Describe the problem and
your proposed approach, and wait for a maintainer to confirm it before you
write code. This avoids duplicate work and catches design constraints early.
Small fixes, such as typos and obvious bugs, can go straight to a pull request.

Check [open issues](https://github.com/devdotfast/review/issues) first.
Questions are welcome on [Discord](https://discord.gg/wYvd2cpMQg).

Report security vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue.

## Setup

Whiteboard requires Node.js 24 and pnpm 11. See the
[desktop prerequisites](apps/review-desktop/README.md#prerequisites), then run
from the repository root:

```sh
pnpm install
pnpm dev
```

A dev build can run alongside an installed Whiteboard. They share the same
data, so commands and your agent's `whiteboard` MCP server talk to one selected
app. Run `whiteboard instances` to see which one, `whiteboard instances use
<key>` to change the default, or set `DEV_REVIEW_INSTANCE=<key>` in the shell
you start your agent from. Reconnect the MCP server after switching.

## Repository layout

The product is named Whiteboard, but package names and directories still use
`review`.

- `apps/review-desktop/` contains the desktop app, packaging scripts, and the
  vendored Code - OSS fork. See
  [apps/review-desktop/README.md](apps/review-desktop/README.md) for build,
  packaging, and release details, and
  [apps/review-desktop/UPSTREAM](apps/review-desktop/UPSTREAM) for the
  Code - OSS source revision and fork differences.
- `packages/review/` contains the `whiteboard` command-line interface, embedded
  server, and canvas.
- `packages/review-protocol/` contains the shared process contracts.
- `packages/trace-core/` and `packages/trace-protocol/` contain agent trace
  capture and the hosted trace store contract.
- `packages/agent-plugins/` contains the plugins and skills for supported
  coding agents.
- `packages/local-vcs/` contains local version-control helpers.
- `diffr/` contains the Rust diff engine, CLI, terminal UI, and the
  `@dev.fast/diffr` TypeScript protocol package under `diffr-ts/`.

The files under `apps/review-desktop/code-oss/` include upstream contribution
and security documents. Those files apply to Microsoft's VS Code project; this
document and [SECURITY.md](SECURITY.md) apply to Whiteboard.

## Testing

Run the full check suite before you open a pull request:

```sh
pnpm run ci
```

Diffr has separate Rust and release checks. From `diffr/`, run
`cargo test --locked` and `cargo fmt --all -- --check`. The monorepo's Diffr Test
workflow runs these on supported targets and checks the TypeScript contract
against the binary.

DOM-facing tests run in Chromium through Vitest Browser Mode. Install the
browser once, then run the headless suite or watch mode:

```sh
pnpm --filter @dev.fast/whiteboard exec playwright install chromium
pnpm --filter @dev.fast/whiteboard test:browser
pnpm --filter @dev.fast/whiteboard test:browser:watch
```

Pure Node, filesystem, and server tests run through
`pnpm --filter @dev.fast/whiteboard test:node`.

`pnpm --filter @dev.fast/whiteboard test:legacy-corpus` replays a private corpus of
legacy Reviews (from before the Whiteboard rename) through migration. Point
`REVIEW_LEGACY_CORPUS` at a directory whose children are Review UUID folders;
the script fails if the variable is unset. The corpus is copied before it is
touched and the originals are re-verified afterwards.

Test behavior, not implementation. Do not add
[change detector tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html).
If you find one, delete it instead of updating it, and say so in your pull
request.

## Pull requests

Work on a branch, and keep each pull request focused on one change. Avoid
mixing refactors, docs, and features unless they are tightly related.

Write the pull request title as a short, plain-language summary of the change,
such as "Keep code evidence loading until its comparison resolves". In the
description:

- link the issue it addresses;
- describe the behavior you added or changed;
- explain how you validated it; and
- call out anything reviewers should pay attention to, such as stored-data
  migrations, telemetry changes, or changes to the vendored Code - OSS fork.

If your change adds or changes telemetry, update
[docs/telemetry.md](docs/telemetry.md) in the same pull request.

## Telemetry

[docs/telemetry.md](docs/telemetry.md) is the public list of what Whiteboard
sends. This section covers working on it.

### Inspect events

Set `DEV_FAST_REVIEW_TELEMETRY_DEBUG` to `1` or `true` before you start
Whiteboard, because most events come from the local server, not from the CLI:

```sh
DEV_FAST_REVIEW_TELEMETRY_DEBUG=1 whiteboard app launch
```

Whiteboard then prints one line for each event to stderr and sends nothing to
PostHog:

```
[review-telemetry] {"event":"review_command_succeeded","distinctId":"…","properties":{…}}
```

The sink ignores the opt-out rules, because it does not send the events. It
also does not record `review_installation_created` as sent, so the real event
still goes out on the next normal run.

### Environment and channel

`environment` is the first that applies: `smoke` or `e2e` (test harness), `ci`
(`CI` set), `internal`, `production`. These variables set it and `channel`:

- `DEV_FAST_REVIEW_TELEMETRY_ENV`: `e2e` or `smoke` for a test harness. Other
  values are ignored.
- `DEV_FAST_REVIEW_CHANNEL`: set by the app for its server to `stable`,
  `preview`, or `dev`.
- `PROGRESSIVE_REVIEW_TELEMETRY_INTERNAL`: `1` marks telemetry as internal and
  `0` as external, overriding the stored marker and workspace detection.

Tests turn telemetry off with `VITEST=1` or `NODE_ENV=test`. A hardening test
keeps the Microsoft telemetry inherited from Code - OSS disabled.

### Allowlisted but not sent yet

- `agent_kind` on session events.
- `review_review_restored` with `via: open`, the implicit undo when opening a
  dismissed whiteboard.

### Code locations

| Concern                     | File                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Telemetry API and identity  | `packages/review/src/review-telemetry.ts`                                                      |
| Batch queue                 | `packages/review/src/posthog-capture-client.ts`                                                |
| Opt-out rules               | `packages/review/src/telemetry-config.ts`                                                      |
| Developer sink              | `packages/review/src/telemetry-debug-sink.ts`                                                  |
| UI allowlist                | `packages/review/src/ui-telemetry-events.ts`                                                   |
| Error message and frames    | `packages/review/src/error-telemetry.ts`                                                       |
| Message cleaner (VS Code)   | `packages/review/src/telemetry-clean-text.ts`; its header lists every change                   |
| Error reporting rules       | `apps/review-desktop/code-oss/src/vs/review/common/reviewErrorReport.ts`                       |
| Pre-start crash note        | `apps/review-desktop/code-oss/src/vs/review/node/reviewBootstrapBreadcrumb.ts`                 |
| Desktop setting             | `apps/review-desktop/code-oss/src/vs/review/common/reviewConfiguration.ts`                     |
| Settings screen             | `packages/review/app/src/settings-page.tsx`                                                    |
| First-use notice            | `apps/review-desktop/code-oss/src/vs/review/contrib/telemetry/reviewTelemetry.contribution.ts` |
| Error budget and bursts     | `packages/review/src/server/client-error-budget.ts`                                            |
| Account alias               | `packages/review/src/server/account-alias.ts`                                                  |
| Whiteboard lifecycle events | `packages/review/src/server/review-lifecycle-telemetry.ts`                                     |
| Open-timeout watchdog       | `packages/review/src/server/review-open-watchdog.ts`                                           |
| Crash dump upload           | `packages/review/src/server/crash-report.ts`                                                   |
| Crash and hang listeners    | `apps/review-desktop/code-oss/src/vs/review/electron-main/reviewCrashTelemetry.ts`             |
| Crash dump reconciliation   | `apps/review-desktop/code-oss/src/vs/review/electron-main/reviewCrashDumps.ts`                 |
