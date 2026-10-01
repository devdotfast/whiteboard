# JSON review API

Desktop and `whiteboard server start` share `review-api.db` under `DEV_REVIEW_HOME`.
A headless `--state-dir` or `DEV_REVIEW_SERVER_DIR` selects an isolated profile;
Desktop can view it by using the same directory as `DEV_REVIEW_HOME`.
Both hosts mount the same routes behind token authentication and a bounded JSON request reader.
The canvas and Home read only the native JSON store. `POST /:id/open` opens a review
in Desktop, and pinned tabs reopen after restart. The startup importer migrates
saved MDX reviews before the server starts; there is no legacy runtime or second
catalog. Tests inject the native store and source-data provider.

## Storage and ownership

- `reviews`: current version and one increasing ID counter per review.
- `versions`: complete JSON snapshots, including title, source pins, and content.
- `authoring_presences`: one row per agent working on a review (focus, color slot, where it last wrote, expiry).
- `repositories`: server-only local paths; clients receive an ID and display name.
- `resources`: immutable image, trace and software-map bytes, scoped to a repository.
- `review_attention`: viewed/dismissed timestamps, separate from document history.

One host-owned store serializes writes, including asynchronous validation.
Presences show who is working across database connections and never block a
write. Mutation commits recheck the current version after asynchronous
validation, so independent connections cannot overwrite a newer version.
Each connection checks SQLite `data_version` every 250 ms and refreshes document,
catalog and activity subscriptions after another connection commits. Desktop is
the sole owner of workspace preparation and cleanup; headless connections never
instantiate that manager. A database-backed process claim prevents a second
Desktop from resetting live workspace generations or running duplicate jobs.
The caller closes the store after closing the HTTP server.

The document is a tree of Markdown and self-contained components. The server
adds IDs directly to those objects. No content hashes, manifests, global
definition tables, retired-ID scans, or second authoring representation.
Updates/moves retain IDs; replacement retains the outer ID but creates fresh
child IDs. Restoring an old snapshot does not roll back the ID counter.

## API

All paths below are relative to `/reviews-api`.

| Request                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                       | Current review summaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /authoring`                                              | Tool names, host input schemas and HTTP mappings for CLI/MCP adapters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /capabilities`                                           | Desktop availability and permission for optional software-map generation, independent of opening a review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /:id/activity`                                           | Currently reported authoring work, not stored in document history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /:id/activity/{begin,update,end} {activityId?,focus?}`  | Begin a presence (returns its `activityId`), update its focus and expiry, or end it; each returns the review's live presences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /watch`                                                  | NDJSON review summaries: initial list, then saved changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /watch?subscriptions=…`                                  | One NDJSON connection for multiple `{reviewId}` subscriptions; `reviewId:null` selects the catalog. Each line is an ordered array of `{value}` or `{error}` results, with `null` where a subscription is unchanged since the previous line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /:id`                                                    | Compact outline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /:id?targetId=step-3`                                    | Full block, sequence step, flow node or flow edge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /:id?full=true`                                          | Full snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /:id?version=2&full=true`                                | Historical snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /:id/history`                                            | Saved versions with titles and timestamps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /:id/inspect`                                            | Agent reading view: nested text outline with IDs; `targetId` reads one component completely, `full=true` includes all content, `version` selects history. `format=json` returns raw data instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /:id/open`                                              | Open the review in the attached Desktop; report an error when none is attached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /:id/watch`                                              | NDJSON snapshots: current state immediately, then committed updates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /commands`                                              | Apply one command; return review ID, version, and for an edit the target ID, its `type`, and — after an insert or replace — `children`: its first-level children as `{id,type}` (a container's blocks; a diagram's steps, or nodes then edges), so new components are addressable without a read. A `create` with `pullRequestUrl` returns the newest existing review for that PR instead (owner/repository matched case-insensitively) unless `operation.reuseExisting` is `false`: `created:false`, a `note`, its stored `target`, `headMoved`, and `working`/`otherReviewIds` when they apply; its target is never moved. A new review reports `created:true`. Either way the result carries `review`, the review's `GET /` catalog entry (target, origin, repository name and path). An interactive `create` also opens the new review in an attached Desktop unless `operation.open` is `false`, and reports `opened` with the open result or an `openError`; the review is saved either way |
| `POST /commands {operation:{type:"lens_edit",reviewId,edit}}` | Write one file lens, credited to `activityId` when given: `insert {title,targets,afterId?}` (host id `lens-N`), `update {targetId,title?,targets?}` or `remove {targetId}`. Returns `{targetId, type:"lens", uncategorized}`, where `uncategorized` lists changed files and ranges no lens covers yet (at most 50 files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /:id/lenses`                                             | The current version's file lenses with each one's file count, plus the same `uncategorized` report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /repositories {path}`                                   | Register a local Git/jj repository; return ID/name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /resources`                                             | Upload an image, trace, or map; return resource ID/kind/MIME type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /:id/resources/:resourceId`                              | Read retained bytes scoped to the review repository; desktop authentication required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /:id/maps/:resourceId?version=0`                         | Read a pinned map with source-change counts for that review version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /:id/file?side=head&file=src/app.ts`                     | Read current target source; version selects authored content; live source always follows the checkout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /:id/tree?path=src&side=head`                            | Immediate target directory entries; path defaults to root, side to head; optional version/commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET /:id/commits?version=0`                                  | List commits and their first-parent statistics for that review version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /:id/diff`                                               | Changed-file summaries `[{path, previousPath?, status, additions, deletions}]`; optional version and commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Example request:

`review_get` uses `/inspect`. MCP returns its text directly, and
`whiteboard api review_get '{"reviewId":"…","full":true}'` prints it without JSON
escaping. Use `format:"json"` (or CLI `--json`) when raw objects are needed.
The canvas continues to use the JSON snapshot routes above.

```json
{
  "operation": {
    "type": "edit",
    "reviewId": "<returned by create>",
    "edit": {
      "type": "insert",
      "content": {
        "type": "markdown",
        "markdown": "# Summary\n\nWhat changed."
      }
    }
  }
}
```

Commands: `create {title,target,pullRequestUrl?,reuseExisting?}` or `create {pullRequestUrl,title?,repositoryId?,reuseExisting?}`, `set_target {reviewId,target,pullRequestUrl?}`, `edit {reviewId,edit}`, `rename {reviewId,title}`,
`restore {reviewId,version}`. A review's pins, `{repositoryId,base,head}`, are its target resolved to immutable commits.
Agents name the checkout by `repositoryPath` in a target, or on a create from a PR alone; `/commands` registers the path and passes the store its id. Retargeting preserves content and component IDs. Restore restores title, target, PR identity, and content. Live targets still read the current checkout.
PR URLs must be canonical `https://github.com/owner/repository/pull/123` URLs. The PR number is derived from the URL; identity is metadata alongside immutable pins, not a moving source reference. A `create` with a target keeps that target and treats the URL as identity only. A `create` with the URL and no target resolves the PR when accepted: it reads the PR with `gh pr view` (falling back to the public GitHub API), picks the registered checkout named by `repositoryId`, else the checkout of the PR's existing review, else the first registered checkout with a remote whose configured URL is `github.com/owner/repository`, and fetches `refs/pull/N/head` and the base branch from that remote into `refs/review/github/owner/repository/pull/N/*`, never moving branches or bookmarks (a jj repository indexes the commits through a transient tag). It pins that head and its merge base with the base branch; for a PR absorbed by a merge commit it uses the merge base with GitHub's frozen base commit instead. The title defaults to the PR title. A repeat resolves the PR again, so `headMoved` compares the existing review with the PR's current head. `set_target` preserves the document and component IDs, including when source commits change. Its response reports retained source ranges to verify, those in files the new commits changed, and resources that no longer match the pins; agents repair these with `edit`. Existing versions keep their original pins and content. It preserves omitted PR identity within one repository, clears it when switching repositories, and accepts an explicit URL or null.

`attention {reviewId,action:"view"|"dismiss"|"restore"}` records viewing or
reversible dismissal without creating a document version. Home summaries include
the repository name and attention timestamps.
The list stream is separate from document streams. Dismissal closes
the native tab and can be undone from Home. Dismissed API reviews stay saved;
`delete {reviewId}` permanently removes their versions. Old command
inputs are erased but their IDs remain, so delayed retries cannot resurrect content.
Repository resources remain shared. Home and the canvas open a pinned, read-only
source tree. Each source tab names its review version; files opened from it use
the same version and side through the API, without a client-side checkout path.

Edits: `insert {content,parentId?,afterId?}`, `update {targetId,changes}`,
`move {targetId,parentId?,afterId?}`, `remove {targetId}`,
`replace {targetId,content}`. Omitted placement appends to the root; on the
scratchpad it prepends instead, so the pad reads newest first. Diagram
units (a `step` in a sequence, a `flow_node` or `flow_edge` in a flow diagram)
require their diagram as the parent and can move within it, but not between
diagrams; removing a flow node removes the edges that touched it. A new
`flow_node` may carry `link:{from|to,label?,style?}` naming a node already
drawn: the node and its edge are saved in one version, the edge stored as an
ordinary `flow_edge`, and the version's `lastEdit.linkId` names it so the
canvas draws the node in its final place and then the edge. Field patches
preserve omitted values; null removes optional fields. Child collections use
structural edits or replacement. Use fresh content without IDs for insert/replace.

Each accepted edit is one saved version, and the version carries
`lastEdit: {type, targetId, blockId, kind, unit?, linkId?, fields?, units?}`:
the edit's kind, the element it landed on, what that element is, and the block
it belongs to (`unit` names a step, flow node or flow edge inside `blockId`;
`fields` lists an update's patched keys, so a `defaultCollapsed` patch draws nothing;
`units` lists a diagram's steps, or its nodes and edges, in drawing order when
the diagram was inserted or replaced whole, each edge once both of its nodes
are drawn). Versions made by rename, set_target, restore or import carry none.
While a reader is watching, the canvas draws each version's edit as it lands:
a paragraph lands, a unit added to a diagram is traced where it attaches, and a
diagram written whole is traced in one quick pass.

There is no expected-version parameter. Later same-field edits win. A command
whose response was lost may or may not have applied; read the review before
retrying.

## Validation and remaining work

Markdown source links use `[label](review-source:head/src/save.ts#L10-L24)`
(or `base`, or `#L10` for one line). Paths are repository-relative and URL-encoded
where needed. Inline and reference-style links open the existing native side peek.
The same Markdown parser feeds the host's source checks and the renderer, so code
examples and unused definitions do not become source requests. Invalid paths or
ranges reject the edit before saving. No extra node type or endpoint is needed.

Heading ids are `slugify(text)` made unique in document order over section
titles and the root-level h2/h3 of Markdown blocks, and `[text](#slug)` links
scroll to them. Markdown images with `https:` sources render inline.

The component schema checks inputs; field patches are checked after merging
with the target. A small relationship pass checks diagram actors, store fields,
and base/head frame sides. Sources and resource references use required host
providers before a version is saved; unchanged references at unchanged pins
are not checked again. Provider errors must use `ReviewInputError` for messages
safe to show to clients; unexpected provider/storage failures return HTTP 500.

The local provider uses existing Git/jj helpers to read committed objects, not
working-copy files. It checks code ranges and resource ownership before saving.
Images are fully decoded to PNG; traces retain supplied text with an explicit
client-supplied provenance label. Map uploads use the existing nested map format,
with a JSON shape check followed by the existing relationship/coverage validator
and pinned source-range checks. Uploads take `{id,repositoryId,kind,...}` with
`base64` for images, `trace:{label,events:[{id,role,text}]}` for traces, or
`pins,side,model` for maps. Reusing an upload ID requires identical content.

The canvas preserves React identities during updates. The stream coalesces
updates when a reader falls behind; reconnecting starts with the current saved
snapshot. Historical views read a fixed snapshot and do not follow live edits.
Call-stack frames can supply a component-local `key` to align the same frame
across base/head despite moved source ranges. Without a key, matching uses the
file and range. This is separate from each frame's durable element identity.

File and diff reads also accept `commit` to compare one listed commit against
its first parent. It must belong to the requested review version; an unrelated
commit returns 404. Without it, the comparison is the review's base and head.

Native code-peek and diff widgets can now consume API-backed read-only models,
including renamed files and absent diff sides. Native opening supplies this
adapter to the API canvas. Inline maps use the same pinned-source API for their
code inspectors, including unchanged mapped ranges. Immutable map resources
change through document edits, so these maps do not expose the old artifact
refresh action. Fullscreen uses the existing canvas-root overlay.
The Map tab uses the retained head/base maps and updates as they arrive.
The Trace tab and quote side panels read retained trace resources; imported
labels are preserved without claiming a harness, commit association, or timestamps.

The thin agent clients use `whiteboard api <tool-name> '<json>'` (or `-` for stdin)
and `whiteboard mcp` (stdio). `whiteboard api tools` lists the host's tool schemas.
Both adapters use existing desktop discovery/authentication and the same HTTP
routes as the canvas. Neither imports the store or validates document content.
Command/resource schemas come from the server's existing Zod definitions and
the read routes share their query schemas with the catalog (`read-schemas.ts`);
the MCP SDK handles framing. The checkout skill describes this JSON workflow while
preserving the writing guidance. No integration is installed automatically.

The Review tab counts a review as ready once it has content and no authoring
presence is live. The last presence ending (or expiring) is the only completion
signal; there is no per-section progress state. Versions and share bundles
saved while sections carried a `status` field are read and imported without it;
new edits that send one are rejected by the strict section
schema.

Activity is presence, not ownership. Begin returns a host-assigned `activityId`
and a color slot (the lowest one free on that review, kept until it ends);
update changes the focus and extends the presence; end removes it. `edit` and
`lens_edit` accept an optional `activityId`: the write renews that presence,
records where it last wrote (`document` or `lenses`), and stamps the version's
`lastEdit.activityId` so the canvas knows whose courier draws it. Without one,
a write is credited to the review's only presence when there is exactly one. No
write is ever refused because another agent is working. A presence expires 3
minutes after its last credited write or update; deletion removes it. Uploads
are immutable repository resources and do not require a presence.
The existing document stream includes an `activity` snapshot and also sends on
activity changes; activity-only sends reuse the loaded document, and the canvas
only loads document data when its version changes.
This avoids another long-lived browser connection. The badge is hidden while
idle or viewing history, and reports unknown activity on a lost connection.
Optional `focus:{description,targetId?}` identifies the current work; description is 1–160 characters and targetId is an existing component ID. Omitted focus retains the current focus; null clears it. Snapshots list `activities` (`activityId`, `slot`, `focus?`, `surface?`) while any are live. The header shows descriptions, and matching components show an inline working indicator. Focus is ephemeral, disappears when its presence ends or expires, and is hidden when activity is unknown or history is displayed.
There is no applying-update state. CLI/MCP expose this as `review_activity_begin`, `review_activity_update` and `review_activity_end`.

Profile migration remains later work.

The focused test file exercises all twelve block kinds, edits and identity,
history/restart, retries, asynchronous validation, isolation, and the actual
desktop HTTP route. The local-data tests use a real Git repository with dirty
working-copy files, decoded images and saved trace/map evidence, including real
HTTP requests and restart. Existing desktop-server tests remain unchanged.

### Language information and committed source

Committed reviews use Review-owned worktrees at their base/head commits for
language services. The displayed source remains the immutable Git source.
Existing matching managed checkouts are reused; an equal base/head shares one
checkout. Opening a review prepares its current sides in the background; older
versions and selected commits acquire environments on demand.

Configure preparation through the repository's existing Git configuration:

```sh
git config devfast.prepare 'pnpm install --frozen-lockfile'
git config --add devfast.prepare 'pnpm generate'
```

Commands run in order inside each managed checkout, never in the invoking user
checkout. Successful preparation is cached by checkout and command-list hash;
changed commands or recreated checkouts invalidate it. Preparation has no canvas
disclosure. `review_open`, and `review_create` when it opens the review, starts acquisition in the background and returns any
already-recorded acquisition issues. `review_environment` rechecks current base/head
checkouts; `retry:true` explicitly reruns failed preparation. Missing setup, pending preparation,
and failed commands with a usable checkout do not produce issues. These checks
report acquisition failures (including transient errors), not end-to-end LSP health.
`review_workspace_cleanup` lists failed cleanup of retired checkouts and accepts
`workspaceId` to retry their removal. Reading and authoring stay available
while preparation runs. Language requests wait for preparation; no command or a
failed command leaves best-effort language services in that same pinned checkout,
without silently borrowing another checkout. Timeout and shutdown stop command
process groups, leave no successful marker, and allow retry.

Language queries require the displayed file to exactly match the file in the
language environment. A changed file suppresses queries even on unchanged lines;
matching contents use the same positions directly. Stale-request checks discard
answers if the source or environment changes during a request.

Definitions, type definitions, implementations, and references stay in the same
review version, side, and selected commit when the destination file matches its
saved source. Preparation may generate or modify files: changed or absent saved
destinations retain their native managed-checkout URIs.

Preparation does not guarantee reproducibility unless the configured commands
also reproduce dependencies, generated files, and the toolchain. Historical
checkouts remain until their owning review is deleted. Environment state and
commands are local and are never authored into review documents.

## Review targets

`target` is either `{kind:"worktree",repositoryId,base?}` or
`{kind:"commits",repositoryId,head,base?}`. Commit revisions resolve on acceptance.
Omitted commit base means source at head with no diff, exactly as base=head;
supply its parent to review the changes introduced by a single commit.

A worktree target follows saved files in that registered checkout, including
staged and unstaged changes. Git's untracked files are left out; `git add -N` a
new file to include it (jj tracks new files itself). The Diff view counts the
untracked files left out. `base` names the branch to
compare against, by default the default branch (`origin/HEAD`, `origin/main`,
`origin/master`, `main`, then `master`); an unborn repository compares with
empty source. The comparison starts at the merge base of `base` and HEAD,
resolved again whenever the checkout or its refs change, so it follows a rebase;
if `base` stops resolving, the last merge base stays. No checkout is created.
Source ranges default to the head side. File saves refresh source without changing
authored history. All versions of a live target read the current checkout; authors
maintain their source references. Use a commit target for fixed source.
