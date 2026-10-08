# Review diff examples

Start with [enclosing context](06-enclosing-context/README.md), then [changed imports](02-changed-imports/README.md).

These are proposed behavior fixtures for our Difftastic extension, not captured output from Difftastic. Each folder contains `before.py`, `after.py`, `expected.json`, and a readable patch with annotations. Expected JSON contains only the new annotation fields; the existing `DiffResult` is not duplicated here.

| Example | Expected behavior |
|---|---|
| [Unchanged imports](01-unchanged-imports/README.md) | Paired section, unchanged contents |
| [Changed imports](02-changed-imports/README.md) | Paired section, unequal lengths, interior comment |
| [Added imports](03-added-imports/README.md) | Head-only fold |
| [Deleted imports](04-deleted-imports/README.md) | Base-only fold |
| [New function replacement](05-new-function-replacement/README.md) | Added body replaced by supplied text; signature retained |
| [Enclosing context](06-enclosing-context/README.md) | Signature, return opener and closer outside normal context |

## Proposed annotation shape

```rust
struct DiffResult {
    // Existing Difftastic fields, including hunks.
    folds: Vec<Fold>,
}

struct Hunk {
    // Existing novel lines and line correspondence.
    context: Vec<Correspondence<SourceRange>>,
}

struct Fold {
    regions: Correspondence<SourceRange>,
    placeholder: String,
}

enum Correspondence<T> {
    Paired { lhs: T, rhs: T },
    Deleted(T),
    Added(T),
}

struct SourcePosition {
    line: LineNumber,
    byte_column: usize,
}

struct SourceRange {
    start: SourcePosition,
    end: SourcePosition,
}
```

Coordinates are zero-based lines and UTF-8 byte columns; ends are exclusive. Paired ranges are corresponding regions, not a claim of identical contents. Fold ranges omit the trailing newline; inline replacements and multiline placeholders must remain possible. This JSON spelling is a review notation, not a committed serialization contract.

There is no collapsed-state field: the frontend chooses its policy. A paired fold has one toggle. Context ranges supplement the normal visible diff lines and are deduplicated when already visible. The context fixture assumes three ordinary context lines, not an exact snapshot of upstream hunk grouping. The frontend must still compute alignment and gap controls; these fixtures specify source ranges, not pixel layout.

No comparison-engine changes or pseudocode generation are implemented here. Import-group pairing and context selection are desired behavior to implement using existing parses/matches, not assertions that Difftastic already emits these groupings.

Next examples to agree on: multiline signatures/imports, Unicode byte columns, inline folds, and folds crossing changed-region boundaries. Performance baselines should be recorded before modifying the engine.

Upstream baseline: `274d0a8f57291477cfbfb27bace0d82395d15c97`.
