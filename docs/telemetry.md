# Telemetry

Whiteboard collects a small amount of anonymous usage and reliability data. We
use it to learn which parts of Whiteboard are useful and where the app is
failing.

This page is the complete public contract for Whiteboard app and `whiteboard`
CLI telemetry.
For a shorter overview of all product data, including local files, coding
agents, and bug reports, see [Privacy](privacy.md).

## The short version

- Anonymous telemetry is on by default and can be turned off at any time.
- Whiteboard records actions such as opening a whiteboard, changing tabs, using code
  navigation, or completing a CLI command. Values are limited to fixed
  categories, booleans, counts, durations, versions, and opaque identifiers.
- Passive telemetry never includes your code, diffs, file paths, repository
  name, whiteboard title, refs, revision hashes, whiteboard ID, coding-agent
  session ID, whiteboard text, prompts, or model output.
- Whiteboard uses a random installation ID, never your email, username,
  hostname, or a hardware identifier. Signing in with GitHub links
  installations of the same account through a one-way hash.
- Product errors may include a cleaned error message and stack frames from
  Whiteboard's shipped program. Paths, web and email addresses, and recognizable secrets are removed
  on your machine before the event is accepted.
- Sending a bug report is a separate, explicit action. You see and control its
  attachments before anything is uploaded.

Whiteboard sends anonymous telemetry to PostHog. PostHog may derive a coarse
location during ingestion; our project discards the source IP.

## Turn telemetry off

In Whiteboard, open **Settings** and disable **Share anonymous
usage data**. The setting controls both the app and the `whiteboard` CLI on
that installation. Disabling it also clears any queued events that have
not been sent.

For a single command, a shell, or a headless environment, set `DO_NOT_TRACK`:

```sh
DO_NOT_TRACK=1 whiteboard info
```

Whiteboard also honors these variables when their value is `1` or `true`:

- `DO_NOT_TRACK`
- `DNT`
- `PROGRESSIVE_REVIEW_TELEMETRY_DISABLED`
- `DEV_FAST_TELEMETRY_DISABLED`
- `DEV_FAST_PROGRESSIVE_REVIEW_TELEMETRY_DISABLED`
- `DEV_FAST_REVIEW_TELEMETRY_DISABLED`

The desktop app sets `DEV_FAST_REVIEW_TELEMETRY_DISABLED` for its own server
from the in-app setting, so setting that one variable in your shell does not
turn off app telemetry. Use `DO_NOT_TRACK` or the setting instead.

An explicit bug report is still sent if you choose **Send** in the bug-report
dialog. Bug reports do not pass through the passive telemetry system.

## What Whiteboard collects

| Category           | Examples                                                  | What is not included                                       |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| App usage          | A whiteboard opened, a tab viewed, a map expanded         | Whiteboard text, code, paths, or repository details        |
| CLI usage          | Command category, success or failure, duration            | Command arguments, refs, process output, or exception text |
| Code navigation    | Feature category, language category, editor surface       | Symbols, declarations, search text, or source code         |
| Extensions         | An allowlisted extension ID, install outcome and duration | Extension version, configuration, or extension data        |
| Whiteboard outcome | Dismiss, restore, or delete                               | Whiteboard text or reviewer identity                       |
| Reliability        | Error class, cleaned message, shipped-program frames      | User paths, repository frames, secrets, or authored text   |

Every event is checked against an allowlist on your machine. Unknown events,
unknown properties, and values outside their allowed categories are dropped.
The full event-by-event list begins at [Event reference](#event-reference).

## Identity and storage

On first use, Whiteboard creates a random installation ID in
`~/.dev/telemetry/`. Whiteboard Preview keeps its own. Events carry
`$process_person_profile: false`, so PostHog keeps no person profile.

**Signing in with GitHub** (in the app or with `whiteboard login`) sends one
`$create_alias` linking the installation ID to `gh_` plus a one-way hash of
your account ID. Your account ID, login and email never leave the machine.
Installations signed into the same account then share one PostHog person.

Events that concern one whiteboard carry `review_id` and `presentation_id`,
one-way hashes keyed by the installation ID. The same whiteboard gets a
different ID on another installation, and the raw IDs are never sent. Each CLI
run has a random `command_run_id`.

Unsent events wait in a local queue of at most 1,000 events and are deleted
after seven days. Telemetry never blocks Whiteboard from working. Whiteboard
disables the Microsoft telemetry built into Code - OSS.

## How events leave the app

The canvas and desktop window do not connect directly to PostHog. They send
events to Whiteboard's local server, which checks the allowlist before adding an
event to the queue. The CLI uses the same queue and transport.

```text
Whiteboard app    ──┐
Whiteboard canvas ──┼─→ local allowlist ─→ disk queue ─→ PostHog
whiteboard CLI    ──┘
```

User-initiated bug reports take a separate path:

```text
Whiteboard ─→ local server ─→ bug.dev.fast ─→ private Cloudflare R2
                                      └─→ attachment-free PostHog metadata
```

## Event reference

### Common properties

Every event from the Whiteboard telemetry API includes these properties:

| Property                  | Value                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `cli_version`             | CLI package version (`version` repeats it for one release)                                                                |
| `app_version`             | Whiteboard app release: the app's own, or the Desktop a `whiteboard api` or `mcp` process reached; absent if none         |
| `channel`                 | `stable`, `preview`, or `dev` for an unpackaged build                                                                     |
| `environment`             | `production`, `ci`, `internal`, `e2e`, or `smoke`                                                                         |
| `surface`                 | `desktop`, `cli`, `headless`, `mcp`, or `api`                                                                             |
| `node_major`              | Node major version                                                                                                        |
| `platform`                | Node platform enum                                                                                                        |
| `arch`                    | Node architecture enum                                                                                                    |
| `os_version`              | Kernel release string                                                                                                     |
| `ci`                      | Boolean                                                                                                                   |
| `internal`                | Boolean for a dev.fast workspace build or a stored internal marker                                                        |
| `app_session_id`          | One UUIDv7 per app launch, shared by every app process                                                                    |
| `install_age_days`        | Whole days since this installation ID was created (for an older installation, since the first run that recorded it)       |
| `$session_id`             | The same ID as `app_session_id`, so PostHog groups a launch's events into one session; absent when the ID is not a UUIDv7 |
| `$process_person_profile` | `false` until this installation is aliased to a GitHub account (see "Identity and storage"), then `true`                  |

`environment` is `production` unless Whiteboard runs in CI (`ci`, when `CI` is
set), in a test harness (`e2e` or `smoke`), or as a dev.fast team build
(`internal`).

The event names predate the Whiteboard name and are unchanged. UI events also
include `source: review_app`.

Events about one opened whiteboard also include `review_id` and
`presentation_id`. Global main-process and renderer errors remain unscoped;
Whiteboard does not guess which open whiteboard caused them.

`review_telemetry_dropped` carries the common properties of the process that
dropped the events.

### CLI and lifecycle events

| Event                           | Additional properties                                                                                                                          | When                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `review_installation_created`   | None                                                                                                                                           | The first enabled Whiteboard use                                                             |
| `review_command_started`        | `command_path`, `command_run_id`, `agent_kind`                                                                                                 | A public CLI handler is about to run                                                         |
| `review_command_succeeded`      | `command_path`, `command_run_id`, `exit_code`, `duration_ms`                                                                                   | A public CLI command succeeds                                                                |
| `review_command_failed`         | The success properties plus `error_name` and `error_category` closed enums                                                                     | A public CLI command fails                                                                   |
| `review_telemetry_dropped`      | `reason`, `count`                                                                                                                              | The queue drops one or more events                                                           |
| `review_session_started`        | `source_kind`; `remote`; `pr_provider` in github, github_enterprise, azure_devops; `review_id`, `presentation_id` | A whiteboard opens in the app canvas                                                         |
| `review_review_presented`       | `load_ms`, `review_id`, `presentation_id`                                                                                                      | The canvas signals ready                                                                     |
| `review_first_review_presented` | `review_id`, `presentation_id`                                                                                                                 | The first presented whiteboard on this installation                                          |
| `review_session_ended`          | `outcome`, `duration_ms`, `review_id`, `presentation_id`                                                                                       | The whiteboard closes; see outcomes below                                                    |
| `review_crash`                  | `process` in `renderer`, `gpu`, `utility`, `server`, `unknown`; `reason` (≤40 chars); `exit_code`; `uptime_ms`; `source` in `live`, `minidump` | A Whiteboard process dies, or an uncovered dump is found on the next launch                  |
| `review_hang_started`           | None                                                                                                                                           | An app window stops responding                                                               |
| `review_hang_ended`             | `duration_ms`                                                                                                                                  | The window responds again, its process dies, or it closes                                    |
| `review_app_ready`              | `duration_ms`; `install_location` on a packaged macOS build, see below                                                                          | The workbench restores, timed from the startup trace; once per app launch                    |
| `review_loopback_tls_fallback`  | `error_name` of the failed request                                                                                                             | A window cannot reach the local server over HTTPS and falls back to plain HTTP               |
| `review_error_burst`            | `message_hash`, `suppressed`                                                                                                                   | A `review_client_error` passes 5 reports for one message in one session; see "Error reports" |
| `review_open_timeout`           | `elapsed_ms`, `review_id`, `presentation_id`                                                                                                   | A session starts and no presented or ended event follows within 30 seconds                   |
| `review_review_created`         | `via` in `api`, `mcp`, `other`; `blocks`; optional `agent_kind`                                                                                | A whiteboard is created; `via` is `other` for the app's own UI                               |
| `review_review_published`       | `version`                                                                                                                                      | A whiteboard is published for sharing                                                        |
| `review_review_revoked`         | None                                                                                                                                           | A share link is revoked                                                                      |
| `review_authoring_completed`    | `duration_ms`; optional `agent_kind`                                                                                                           | The first publish of a whiteboard created via `api` or `mcp`, timed from its creation        |
| `review_mcp_tool_called`        | `tool`; `via` in `api`, `mcp`; `ok`; `duration_ms`; `agent_kind`; on failure, `error_name` and `error_category` closed enums                   | An agent calls a Whiteboard authoring tool; `tool` is `other` if none was reached            |
| `review_login_started`          | None                                                                                                                                           | GitHub sign-in in the app begins                                                             |
| `review_login_succeeded`        | None                                                                                                                                           | GitHub sign-in in the app finishes                                                           |
| `review_login_failed`           | `reason` in `did_not_finish`, `error`                                                                                                          | GitHub sign-in in the app fails                                                              |
| `$exception`                    | Same fields as `review_client_error`, in PostHog's error-tracking shape                                                                        | Sent alongside every `review_client_error`, for one release                                  |
| `$create_alias`                 | `alias`, `$process_person_profile: true`                                                                                                       | The first GitHub sign-in on this installation; see "Identity and storage"                    |

`source_kind` is `worktree`, `commits`, or `project`, set by the server from
the opened whiteboard.

`agent_kind` comes from the agent's session environment (`CODEX_THREAD_ID`,
`CLAUDE_CODE_SESSION_ID`, `PI_SESSION_ID`). Over MCP, the client name the agent
sends when it connects takes precedence, because some agents, Codex among
them, start MCP servers without those variables. Cursor, OpenCode and Oh My Pi
are identified only by that name. A client name is matched to the closed list and never sent.

| `outcome`   | Meaning                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `closed`    | The tab closed or another whiteboard replaced it                                                                                                     |
| `dismissed` | The open whiteboard was dismissed while its session was active                                                                                       |
| `deleted`   | The open whiteboard was deleted while its session was active                                                                                         |
| `app_quit`  | The app quit, or reloaded, with the whiteboard open                                                                                                  |
| `abnormal`  | The app died with the whiteboard open. Sent by the next launch, without `duration_ms`, with the dead launch's common properties and `app_session_id` |

`command_path` is a closed enum: `help`, `version`, `app.launch`, `app.pick`,
`info`, `connect`, `instances`, `instances.use`, `instances.clear`,
`migrate.apply`, `login`, `logout`, `whoami`,
`trace.store.create`, `trace.store.delete`, `trace.store.info`,
`trace.install`, `trace.allow`, `trace.deny`, `trace.storage.use`,
`trace.config.migrate`, `api`, `mcp`, `server.start`, and `invalid`. Other
commands, such as `share` and `status`, send no command events. Whiteboard
sends no arguments, refs, tokens, or storage credentials. `surface` is
`headless` for `server.start`, `mcp` for `mcp`, `api` for `api`, and `cli`
otherwise, on every event the command's process sends.

Error names and categories are closed enums. A failed command sends no exception
message, stack, path, process output, project identifier, or remediation text.
Only the `review_client_error` and `review_update_failed` events carry message
text, and only as described in "Error reports".

- Error names: `usage_error`, `review_not_found`, `review_state_error`,
  `repository_error`, `desktop_connection_error`, `network_error`,
  `storage_error`, `index_error`, `process_error`, and `unexpected_error`.
- Error categories: `user_input`, `local_state`, `dependency`, `transport`, and
  `internal`.
- Queue drop reasons: `queue_full`, `expired`, `corrupt`,
  `permanent_rejection`, and `storage_failure`.
- Agent kinds: `codex`, `claude`, `cursor`, `opencode`, `pi`, `omp`, and `other`.

### Desktop and canvas events

| Event                             | Additional properties                                                                                                                                                          | When                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `review_app_opened`               | None                                                                                                                                                                           | The canvas app opens                                                                                       |
| `review_tab_viewed`               | `tab` in review, commits, map, files, trace; `duration_ms`; `reason` in tab_change, visibility_hidden, pagehide, unmount                                                       | A tab dwell period ends                                                                                    |
| `review_diff_viewed`              | `duration_ms`                                                                                                                                                                  | A files tab dwell period ends; the server derives it from `review_tab_viewed`, the canvas does not send it |
| `review_peek_opened`              | `via` in prose_link, diagram, map, db_lens, call_stack_frame, diff_definition                                                                                                                  | A user opens a code peek                                                                                   |
| `review_peek_resolved`            | `root_kind` in range                                                                                                                                                           | A code peek the user opened resolves                                                                       |
| `review_peek_resolve_failed`      | `root_kind` in range; `reason` in missing_file, no_alignment, outside_lines, other, error, unresolved                                                                          | A code peek the user opened does not resolve                                                               |
| `review_diff_opened`              | `kind` in commit, structural; `via` in topbar, sidebar, lens, locate, file_picker                                                                                                                   | A user opens a diff view                                                                                   |
| `review_diff_failed`              | `reason` in missing_binary, process_exit, stream_ended, aborted, file_error, other; `files`, 0 when diffr fails before listing files                                          | A diff comparison finishes with files diffr could not diff                                                 |
| `review_diff_loaded`              | `first_file_ms`; `files`; `updates_ms`, only when diffr sent summary updates                                                                                                  | A structural diff comparison finishes loading                                                              |
| `review_discord_clicked`          | `via` in topbar, dialog, docs                                                                                                                                                  | A user clicks a Discord invite                                                                             |
| `review_discord_dialog_shown`     | None                                                                                                                                                                           | The community invite dialog opens                                                                          |
| `review_discord_dialog_dismissed` | None                                                                                                                                                                           | The community invite dialog closes unaccepted                                                              |
| `review_review_shared`            | None                                                                                                                                                                           | A user copies a whiteboard's share link                                                                    |
| `review_review_deleted`           | `via` in home                                                                                                                                                                  | A user deletes a stored whiteboard from Home                                                               |
| `review_tour_started`             | `steps`                                                                                                                                                                        | A user starts a tour                                                                                       |
| `review_tour_step_advanced`       | `step`, `steps`                                                                                                                                                                | A user moves to the next tour step                                                                         |
| `review_tour_abandoned`           | `step`, `steps`                                                                                                                                                                | A user closes an incomplete tour                                                                           |
| `review_tour_completed`           | `steps`                                                                                                                                                                        | A user completes a tour                                                                                    |
| `review_map_expanded`             | `level` in system, container, component, code                                                                                                                                  | A user expands a map element                                                                               |
| `review_commit_diff_opened`       | `via` in row, file, footer                                                                                                                                                     | A user opens a commit diff                                                                                 |
| `review_source_tree_opened`       | `via` in topbar, home                                                                                                                                                          | A user opens the source tree                                                                               |
| `review_client_error`             | See "Error reports"                                                                                                                                                            | A part of Whiteboard reports an error                                                                      |
| `review_update_started`           | Random `update_attempt_id`, `target_version`                                                                                                                                   | An update is downloaded and ready to install                                                               |
| `review_update_completed`         | Start properties plus `duration_ms`                                                                                                                                            | The downloaded target launches after restart                                                               |
| `review_update_failed`            | `phase` in check, download, install; `message_source` in electron, request, shipit, fallback; `error_name`; optional start properties and `duration_ms`; see "Error reports"   | An update check, download, or install fails                                                                |
| `review_bug_report_dialog_opened` | None                                                                                                                                                                           | A user opens the bug report dialog                                                                         |
| `review_bug_report_cancelled`     | None                                                                                                                                                                           | A user closes the dialog without a report                                                                  |
| `review_bug_report_send_failed`   | Short `error_name`                                                                                                                                                             | A bug report request fails                                                                                 |
| `review_setting_changed`          | `setting` in telemetry_enabled, keymap, software_map_enabled, sharing_enabled, diffr_config, theme, ctrl_tab, ready_notification, document_width, code_font_size, document_font_size, reading_font, code_font_family, font_ligatures, diff_font_size, diff_word_wrap, diff_ignore_whitespace; `enabled`; `value` in dark, light (theme only) | A user changes a Whiteboard setting                                                                        |
| `review_review_opened`            | `via` in home, other                                                                                                                                                           | A user opens a whiteboard                                                                                  |
| `review_diff_layout_changed`      | `layout` in split, unified; `scope` in diff, peek                                                                                                                              | A user switches the diff layout                                                                            |
| `review_home_empty_state_viewed`  | None                                                                                                                                                                           | The empty Home state opens                                                                                 |
| `review_find_opened` | `surface` in review, diff | A user opens the find bar |
| `review_ask_sent` | `agent` in claude, codex, cursor, opencode, pi; `follow_up`; `selection` in text, code, diff, review; `remote` | A user sends a question or follow-up in Ask |
| `review_onboarding_step_viewed` | `step` in welcome, install, run | A first-run step opens |
| `review_onboarding_skipped` | `step` in welcome, install, run | A user leaves first run for Home |
| `review_onboarding_run_started` | `mode` in draw, copy; `agent` (draw only) | First run's last step: an agent starts drawing the first whiteboard in the app, or its prompt is copied |
| `review_new_whiteboard_opened` | `via` in button, command, sidebar | A user opens New whiteboard from Home's New button, or with ⌘N or the menu |
| `review_new_whiteboard_started` | `mode` in draw, copy, empty; `embedded`; `agent` (draw only) | An agent starts drawing a whiteboard from New whiteboard, or its prompt is copied; `embedded` is Home's empty state |
| `review_remote_host_installed` | `ok`; `target` in linux-x64, linux-arm64; `duration_ms` | Installing Whiteboard on a remote host ends; a version already there is not counted |
| `review_remote_host_connected` | `ok`; `problem` in unreachable, not_installed, auth_failed, unsupported, incompatible; `direct` | A remote host's connection outcome changes; a host retrying while down reports once |

The canvas sends `review_review_dismissed`, `review_review_restored`, and
`review_review_deleted` from Home's actions, with `via` set to `home`.
`review_review_dismissed` also comes from the whiteboard's top bar, with `via`
set to `review_topbar`.

### Hangs

- `review_hang_started` / `review_hang_ended`: Electron's window
  `unresponsive` / `responsive` events.
- `review_open_timeout`: a whiteboard that neither presents nor ends within 30
  seconds.
- `install_location` on `review_app_ready`: where a packaged macOS build runs
  from, read from the app bundle's path. The path itself is never sent.
  `applications` is `/Applications`, `user_applications` is `~/Applications`,
  `volume` is anything under `/Volumes` (a mounted disk image or an external
  drive), `translocated` is the read-only copy macOS makes of a quarantined app
  opened from Downloads, and `other` is anywhere else. Squirrel cannot update a
  `volume` or `translocated` app. Other platforms and unpackaged builds omit it.

If the app dies with a whiteboard open, the next launch sends
`review_session_ended` with `outcome: "abnormal"`. A workbench reload ends its
session with `outcome: "app_quit"`, the same as quitting.

### Workbench events

| Event                             | Additional properties                                                                                                                                                                                                                       | When                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `review_lsp_used`                 | `feature` in hover, goto_definition, peek_definition, goto_type_definition, goto_implementation, references, rename, format, code_action, symbol_search; `via` in command, mouse; `language`; `editor_kind` in files_tab, inline_peek, diff | A user invokes an LSP feature               |
| `review_ls_activated`             | `group` in python, go, rust, swift, csharp; `ok`                                                                                                                                                                                            | A language server activation check ends     |
| `review_extension_installed`      | Allowlisted `extension_id`; `trigger` in user, auto_upgrade, startup_seed, keymap, rollback; `cached`; `duration_ms`                                                                                                                        | An optional extension installs              |
| `review_extension_install_failed` | Allowlisted `extension_id`; allowlisted `trigger`; `phase` in download, install                                                                                                                                                             | An optional extension install fails         |
| `review_extension_enabled`        | Allowlisted `extension_id`; allowlisted `trigger`                                                                                                                                                                                           | Whiteboard enables an optional extension    |
| `review_extension_disabled`       | Allowlisted `extension_id`; allowlisted `trigger`                                                                                                                                                                                           | Whiteboard disables an optional extension   |
| `review_extension_uninstalled`    | Allowlisted `extension_id`; allowlisted `trigger`                                                                                                                                                                                           | Whiteboard uninstalls an optional extension |

The `language` property is one of typescript, javascript, python, go, rust,
swift, csharp, json, css, html, markdown, yaml, toml, shell, sql, or other.
The allowlisted extension identifiers are `vscodevim.vim`,
`tuttieee.emacs-mcx`, `ms-vscode.sublime-keybindings`, `ms-python.python`,
`astral-sh.ty`,
`charliermarsh.ruff`, `golang.go`, `rust-lang.rust-analyzer`,
`swiftlang.swift-vscode`, `llvm-vs-code-extensions.lldb-dap`,
`muhammad-sammy.csharp`, and `ms-dotnettools.vscode-dotnet-runtime`.
Whiteboard does not send an extension version.

## Error reports

Whiteboard reports its own failures so that a defect that only happens on your
machine can still be found and fixed. Four parts of Whiteboard report an error:
the app window, the canvas, the background process, and a crash that happens
before Whiteboard can start. Uncaught canvas errors are reported once, by the
app window.

Every `review_client_error` is also sent as a PostHog `$exception` with the same
fields; `review_client_error` is removed after one release. After 5 reports of
one `message_hash` in a session, Whiteboard sends a `review_error_burst` instead
and drops the rest.

Whiteboard sends these properties with the `review_client_error` event. A
`review_update_failed` event uses the same server-side message cleaning and
fingerprinting, plus the closed update phase and message-source fields above.
Install failures read at most 64 KiB appended to ShipIt's stderr log after the
matching update was staged. Whiteboard extracts only the last NSError summary (or
the fixed retry-exhausted line); it neither stores nor uploads the raw log.

| Property        | Value                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| `error_process` | Which part of Whiteboard failed: `main`, `renderer`, `canvas`, or `server`        |
| `error_source`  | Which handler caught it, from a closed list                                       |
| `error_name`    | The error class name, such as `TypeError`. Identifier characters only, 40 at most |
| `component`     | A fixed component name, when the reporter has one. Identifier characters only     |
| `message`       | The error message, cleaned. See below                                             |
| `message_hash`  | A fingerprint of the original message. See below                                  |
| `frames`        | Up to 10 stack lines, all inside Whiteboard's shipped program. See below          |

**Whiteboard cleans the message before it sends it.** The cleaner replaces each of
these with a marker that names what it removed, such as
`<REDACTED: user-file-path>`:

- any file path, on macOS, Linux, or Windows,
- your home directory and your temporary directory, which are removed outright,
- any web address, e-mail address, or text matching a known secret format, such
  as an access token or a private key.

So `ENOENT: no such file or directory, open '/Users/you/work/notes.md'` is sent
as `ENOENT: no such file or directory, open '<REDACTED: user-file-path>'`.

The cleaner is Microsoft's, taken from VS Code, which Whiteboard is built on.
Whiteboard uses it rather than a rule of its own so that you can check it against a known
implementation.

Two rules sit on top of the cleaner:

- **Whiteboard sends no message for an error that quotes a whiteboard
  document.** An authoring tool checks authored text against a schema, and
  those errors repeat the text they rejected. Whiteboard keeps the error class, the fingerprint, and the
  stack lines for these, and drops the message.
- **Whiteboard sends no message the cleaner did not finish.** After cleaning,
  Whiteboard checks the result again for a path or a secret. If it finds one, the message
  is dropped. This is a second, separate check, so a fault in the cleaner cannot
  by itself put a path on the wire.

**`message_hash` is a fingerprint of the original message**: the first 16
characters of a one-way SHA-256 digest. It is sent whether or not the message
survives, so reports whose message was dropped still group together. The digest
cannot be turned back into the message.

**Whiteboard sends only frames from its shipped program.** Each frame reads as
`file:line:column`, where the file is a path inside the program, such as
`vs/review/browser/workbench.js:456:12`. Whiteboard finds the shipped program
directory in each frame and discards everything before it, which removes your
home directory. It then keeps a frame only when the result starts inside a known
program directory, including the Code - OSS directories it ships. A frame in your repository, in `node_modules`, or in an
extension is dropped whole, not shortened.

The local server does this work, and the event allowlist checks every
frame a second time. Both steps run on your machine, before anything is sent.

### Crash reports

A `review_crash` records the process kind, Electron's reason, and the exit code,
with no message or stack. Electron also writes a local minidump, which can
contain process memory, including open source text. The next launch uploads it
to `bug.dev.fast` with the common properties and deletes it. A dump no live
event already counted is reported as `review_crash` with `source: "minidump"`.
Dumps older than seven days, or any dump with telemetry off, are deleted
without upload. Uploaded dumps are kept for 30 days, and the Worker records a
`review_crash_uploaded` event without the dump.

## User-initiated bug reports

The **Report a bug** dialog sends data only after the user selects **Send**. The
description is optional. Under **Include diagnostic attachments**, two
independent controls choose what else is attached:

- **Session**: the current whiteboard record and its software maps. On by
  default.
- **Changed-file diffs used by CodePeeks**. On by default.

Whiteboard also captures a screenshot before the dialog opens and attaches it
by default. The dialog shows a removable preview and accepts a replacement
image by paste or drag.

A whiteboard does not always have a software map. The report then omits the
map and records no error, because an absent map is a normal state.

The report payload contains these fields:

| Field                            | Value                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `schema_version`                 | Internal report payload format version                                        |
| `description`                    | Optional user-entered description, limited to 64 KiB of UTF-8 data            |
| `screenshot.mime`                | `image/jpeg` when a screenshot is attached                                    |
| `screenshot.base64`              | JPEG screenshot data, limited to 3 MiB decoded                                |
| `review["review.json"]`          | The saved whiteboard record, when the user consents                           |
| `map`                            | The software maps the whiteboard shows, when the user consents and one exists |
| `diff.baseRef`                   | Base revision for the changed-file diffs, when one is available               |
| `diff.headRef`                   | Head revision for the changed-file diffs, when one is available               |
| `diff.files[].path`              | Current changed-file path                                                     |
| `diff.files[].previousPath`      | Previous path for a renamed file, when one is available                       |
| `diff.files[].status`            | Changed-file status                                                           |
| `diff.files[].additions`         | Added line count                                                              |
| `diff.files[].deletions`         | Deleted line count                                                            |
| `diff.files[].patch`             | Unified patch used to resolve the whiteboard's exact CodePeek ranges          |
| `diagnostics.app_version`        | Whiteboard app version                                                        |
| `diagnostics.cli_version`        | `@dev.fast/whiteboard` package version                                        |
| `diagnostics.platform`           | Node platform enum                                                            |
| `diagnostics.app_session_id`     | Random identifier for the canvas window                                       |
| `diagnostics.client_error_names` | Last 20 sanitized JavaScript error class names from that canvas session       |
| `diagnostics.attachment_errors`  | Selected attachment names with the value `unavailable`                        |

The whiteboard record is the whole saved version: its title and document text,
its lenses, the commits it is pinned to, and where it came from, such as the
branch, base ref, and pull request number and URL. A whiteboard received
through a share link also carries the sharer's GitHub login and the
repository's clone URL. It does not contain source code; the changed-file diffs
are a separate attachment.

If a selected attachment is unavailable, Whiteboard omits it, names it in
`diagnostics.attachment_errors`, and sends the rest. If the report would exceed
the upload limit, Whiteboard drops attachments in this order until it fits:
the diffs, the maps, the screenshot, and the whiteboard record. If it still
does not fit, the report is not sent.

The Worker stores reports in a private Cloudflare R2 bucket. Only credentialed
dev.fast operators can read the bucket. Reports are deleted after 90 days.

After storage completes, the Worker sends a `review_bug_report` PostHog event
with the report ID, date, app version, platform, sizes, attachment presence, and
truncation flags. The event does not contain the description or attachments.

Cloudflare uses `CF-Connecting-IP` only as the rate-limit key. The Worker does
not store that value in R2. The Worker does not send it to PostHog as report
data. The limit is five report attempts per minute for each client IP.

An explicit bug report submission overrides the passive telemetry opt-out.
The local server sends this report even when Whiteboard telemetry is off. The
passive event allowlist and telemetry disk queue do not process bug reports.

To change telemetry or inspect events while developing Whiteboard, see
[Contributing](https://github.com/devdotfast/whiteboard/blob/main/CONTRIBUTING.md#telemetry).
