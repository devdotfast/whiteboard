# Real PR examples for DiffResult

Eleven merged PRs, one complete source file per PR: three Review, four Python, two Rust, two Go. Files are copied byte-for-byte from each PR's merge-base and head commits, with original paths and blob hashes recorded. No code is invented or cropped.

For a changed typed parameter and multiline signature, see [Flask #5526](real/11-flask-5526/README.md).

Start with [Flask's changed imports and enclosing method](real/04-flask-6096/README.md), [a new function in Review](real/03-review-160/README.md), and [Go's nested replacement](real/10-go-git-1492/README.md).

| PR / annotated example | Original file | Language |
|---|---|---|
| [devdotfast/review #108](real/01-review-108/README.md) | `packages/progressive-review/app/src/review-context.tsx` | TSX |
| [devdotfast/review #175](real/02-review-175/README.md) | `packages/progressive-review/src/review-diff-files.ts` | TypeScript |
| [devdotfast/review #160](real/03-review-160/README.md) | `packages/progressive-review/src/opencode-trace-export.ts` | TypeScript |
| [pallets/flask #6096](real/04-flask-6096/README.md) | `src/flask/app.py` | Python |
| [pallets/flask #6133](real/05-flask-6133/README.md) | `src/flask/sansio/scaffold.py` | Python |
| [psf/requests #6965](real/06-requests-6965/README.md) | `src/requests/utils.py` | Python |
| [BurntSushi/ripgrep #3487](real/07-ripgrep-3487/README.md) | `crates/core/main.rs` | Rust |
| [BurntSushi/ripgrep #3496](real/08-ripgrep-3496/README.md) | `crates/ignore/src/walk.rs` | Rust |
| [cli/cli #11038](real/09-cli-11038/README.md) | `internal/config/config.go` | Go |
| [go-git/go-git #1492](real/10-go-git-1492/README.md) | `utils/merkletrie/difftree.go` | Go |
| [pallets/flask #5526](real/11-flask-5526/README.md) | `src/flask/blueprints.py` | Python |

## What is being specified

`expected.json` contains only our proposed additions to Difftastic's `DiffResult`:

```rust
struct DiffResult {
    // Existing Difftastic fields, including hunks.
    folds: Vec<Fold>,
}

struct Hunk {
    // Existing novel lines and line correspondence.
    context: Vec<ContextRange>,
}

struct ContextRange {
    lhs: SourceRange,
    rhs: SourceRange,
}

struct Fold {
    kind: FoldKind,
    regions: Correspondence<SourceRange>,
    placeholder: String,
}

enum Correspondence<T> {
    Paired { lhs: T, rhs: T },
    Deleted(T),
    Added(T),
}

struct SourceRange {
    start: SourcePosition,
    end: SourcePosition, // exclusive
}

struct SourcePosition {
    line: LineNumber,    // zero-based
    byte_column: usize, // UTF-8 bytes, not characters or screen columns
}
```

The same shape is used by all eleven fixtures. `Paired` expresses corresponding regions, even if their contents, lengths or AST shapes differ. It has one fold/unfold interaction. `Added` and `Deleted` target one side only. Placeholders are plain strings; no default/current collapsed state is stored. Context ranges have no hunk indices and no placeholder.

Expected annotations are **manually selected review targets**, not recorded Difftastic output. Pseudocode strings are supplied examples, not generated features. Import folds are candidate affordances even when the imports are outside the initial visible patch; their existence does not force them onto the screen. Candidate grouping/pairing still needs implementation and evaluation against the matcher.

Selected enclosing context includes the closing delimiters as well as headers. Return boundaries are added only when the return expression encloses changed syntax, including Rust tail expressions. Distant returns are not selected merely because they are in the same function. These stay outside body replacements; if already visible in the ordinary diff, they are asserted in `case.json` rather than duplicated in `context`. Returns inside a deliberately folded internal branch may still be hidden. Python has no invented closing delimiter.

Each example deliberately specifies a small selected set, not every possible fold. The first detector can implement import groups; the other examples exercise the domain affordance for later structural folds and supplied replacements.

## Files in each example

- `before.*` / `after.*`: exact pinned sources. An absent side is an empty fixture file; its provenance path and blob SHA are null.
- `provenance.json`: PR URL, merge time, comparison commits, paths, local filenames, original Git blob SHAs and SHA-256 hashes. This is the source identity record.
- `expected.json`: the original flat annotation oracle (`folds` and `context`); this is not the serialized live domain.
- `case.json`: purpose, exact reviewed excerpts selected by the annotations, and source ranges/text that folds must leave exposed. These excerpt assertions are fixture oracles, not domain fields.
- `change.patch`: ordinary Git/Myers diff with three context lines, for comparison. Difftastic may choose different hunks; when integrating, context must be deduplicated against its actual visible rows.
- `README.md`: links and selected ranges with the actual source excerpts.

## Checks

`crates/diffr-core/src/parse/fold_tests.rs` diffs these sources through the engine and checks
that every fold range is valid and every matched fold is reciprocal.

Run from the repository root:

```sh
python3 examples/review/validate.py
```

The offline validator checks distinct PRs, byte-identical source hashes, the annotation shape, source bounds, nonempty ranges, UTF-8 endpoint boundaries, exact selected excerpts, and preserved signatures, selected return statements/tail expressions, and enclosing closing braces that are present in the visible diff or extra context. For these examples, one-sided fold ranges must consist entirely of added/deleted lines. Extra context must be outside the ordinary U3 visible rows. No network or Rust build is required.

The Python validator checks the hand-authored fixture contract. Rust tests additionally exercise the live parser/matcher, fold bounds, import pairing and fallback. They do not establish semantic correctness of every syntax match or split-view alignment. Partial-overlap policy and moved-region layout remain unspecified; do not infer them from these fixtures. All source pairs currently use LF; CRLF and UTF-8 byte-boundary behavior need targeted edge coverage alongside the real PR cases.

The original [synthetic examples](synthetic/README.md) remain available as small explanatory cases; the real corpus is the primary reference. Review fixtures are private-repository code and this corpus is local; nothing has been pushed or published.

Difftastic baseline: `274d0a8f57291477cfbfb27bace0d82395d15c97`. The matching algorithm remains unchanged. Runtime/memory benchmarks have not been added.
