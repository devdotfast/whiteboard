# Privacy

Whiteboard reads source code and agent-authored documents on your machine. This
page covers what stays local, what Whiteboard sends, and what you choose to
share. The [dev.fast privacy policy](https://dev.fast/privacy) is the policy
governing Whiteboard.

## What stays local

Whiteboard keeps whiteboards, including copies opened from share links, in
`~/.dev/review-api.db`, repositories it clones for share links in
`~/.dev/shared-repositories/`, and app state in `~/.dev/review-desktop/`. These
names predate the Whiteboard rename.

## Telemetry and error reports

Anonymous telemetry is on by default. It records feature use as categories,
counts, durations and versions, under a random installation ID. It never
includes source code, diffs, paths, repository names, refs, whiteboard text,
prompts, model output, or your email, username or hostname. Signing in with
GitHub links your installations through a one-way hash of your account ID.

Whiteboard also reports its own errors, with paths, addresses and secrets
removed on your machine first. After a crash, the next launch uploads Electron's
crash dump, which can contain process memory, including open source text. It
is kept for 30 days.

To turn both off, open Settings and disable **Share anonymous usage data**, or
set `DO_NOT_TRACK=1`. With telemetry off, crash dumps are deleted without
upload. The [telemetry reference](telemetry.md) lists every event.

## Bug reports

**Report a bug** sends nothing until you select **Send**. You choose whether to
attach the whiteboard (its text, pinned commits, branch and pull request),
the diffs it shows, and a screenshot. Every report also includes your
description and the app version and platform. Reports are kept in private
storage for 90 days, and are sent even with telemetry off.

## Sharing

Sharing is explicit. `whiteboard share` uploads an immutable copy of one saved
whiteboard version to the /dev/fast share service and returns a link. The copy
includes the document text, software maps, complete trace
conversations, the source lines the whiteboard references, the commits it is
pinned to, your GitHub login, and the repository's GitHub clone URL. Anyone
with the link can read the copy in a browser. Opening it in Whiteboard Desktop
makes a copy you can edit and fetches the pinned commits from GitHub with the
recipient's own access.
`whiteboard share revoke <share-id>` stops future downloads.

## Hosted trace store

Trace capture is off by default and needs your consent for each repository.
Once you allow a repository (`whiteboard trace allow`) with the hosted store
selected, Whiteboard uploads complete agent session transcripts for that
repository to the /dev/fast hosted store. Transcripts can contain prompts,
model output, source code, file paths, URLs and email addresses. Each upload
also records the branch and the Git author name.

Only GitHub users with push access to the repository can find or read its
traces. Read-only collaborators, former contributors and the public cannot,
even for a public repository. Traces are encrypted with keys /dev/fast
controls, so /dev/fast can decrypt them. The GitHub app requests the `repo`
scope to check access.

- `whiteboard trace deny` stops uploads from this machine and keeps earlier
  ones.
- `whiteboard trace store delete` deletes the repository's hosted traces
  (repository admins only). Deletion is not instant: issued download links and
  stored copies expire on a set schedule.
- `whiteboard logout` forgets the local login only.

A store in your own S3 or R2 bucket sends nothing to /dev/fast.
