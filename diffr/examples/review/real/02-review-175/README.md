# devdotfast/review #175

Diff parser fix with a multi-statement paired replacement and enclosing function context. The neutral placeholder describes both versions; changed code remains present underneath it. The return object and closing function brace are additional context outside the U3 patch.

[Original PR](https://github.com/devdotfast/review/pull/175) · [Before](before.ts) · [After](after.ts) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**lhs · extra context · {'line': 265, 'byte_column': 0} → {'line': 274, 'byte_column': 1}**

```typescript
  return {
    path,
    previousPath:
      status === "renamed" ? (renameFrom ?? oldPath ?? undefined) : undefined,
    status,
    additions,
    deletions,
    patch: section,
  };
}
```

**rhs · extra context · {'line': 273, 'byte_column': 0} → {'line': 282, 'byte_column': 1}**

```typescript
  return {
    path,
    previousPath:
      status === "renamed" ? (renameFrom ?? oldPath ?? undefined) : undefined,
    status,
    additions,
    deletions,
    patch: section,
  };
}
```

## Fold and context selections

Placeholder: Imports

### `folds/0/lhs` · {'line': 0, 'byte_column': 0} → {'line': 8, 'byte_column': 70}

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  detectLocalVcs,
  diff as readLocalVcsDiff,
  diffFileSummaries as readLocalVcsDiffFileSummaries,
} from "@dev.fast/local-vcs";
import { jsonString, parseJsonText } from "@dev.fast/review-protocol";
```

### `folds/0/rhs` · {'line': 0, 'byte_column': 0} → {'line': 8, 'byte_column': 70}

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  detectLocalVcs,
  diff as readLocalVcsDiff,
  diffFileSummaries as readLocalVcsDiffFileSummaries,
} from "@dev.fast/local-vcs";
import { jsonString, parseJsonText } from "@dev.fast/review-protocol";
```

Placeholder: Parse file metadata and count changed lines.

### `folds/1/lhs` · {'line': 238, 'byte_column': 0} → {'line': 251, 'byte_column': 3}

```typescript
  for (const line of lines) {
    const parsedOldPath = parseGitFileLine(line, "--- ");
    const parsedNewPath = parseGitFileLine(line, "+++ ");
    if (parsedOldPath !== undefined) oldPath = parsedOldPath;
    if (parsedNewPath !== undefined) newPath = parsedNewPath;
    if (line.startsWith("rename from ")) {
      renameFrom = unquoteGitPath(line.slice("rename from ".length).trim());
    }
    if (line.startsWith("rename to ")) {
      renameTo = unquoteGitPath(line.slice("rename to ".length).trim());
    }
    if (line.startsWith("+") && !line.startsWith("+++ ")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("--- ")) deletions += 1;
  }
```

### `folds/1/rhs` · {'line': 239, 'byte_column': 0} → {'line': 259, 'byte_column': 3}

```typescript
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      const parsedOldPath = parseGitFileLine(line, "--- ");
      const parsedNewPath = parseGitFileLine(line, "+++ ");
      if (parsedOldPath !== undefined) oldPath = parsedOldPath;
      if (parsedNewPath !== undefined) newPath = parsedNewPath;
      if (line.startsWith("rename from ")) {
        renameFrom = unquoteGitPath(line.slice("rename from ".length).trim());
      }
      if (line.startsWith("rename to ")) {
        renameTo = unquoteGitPath(line.slice("rename to ".length).trim());
      }
      continue;
    }
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
```

### `context/0/lhs` · {'line': 228, 'byte_column': 0} → {'line': 228, 'byte_column': 70}

```typescript
function parseReviewDiffFile(section: string): ReviewDiffFile | null {
```

### `context/0/rhs` · {'line': 228, 'byte_column': 0} → {'line': 228, 'byte_column': 70}

```typescript
function parseReviewDiffFile(section: string): ReviewDiffFile | null {
```

### `context/1/lhs` · {'line': 265, 'byte_column': 0} → {'line': 274, 'byte_column': 1}

```typescript
  return {
    path,
    previousPath:
      status === "renamed" ? (renameFrom ?? oldPath ?? undefined) : undefined,
    status,
    additions,
    deletions,
    patch: section,
  };
}
```

### `context/1/rhs` · {'line': 273, 'byte_column': 0} → {'line': 282, 'byte_column': 1}

```typescript
  return {
    path,
    previousPath:
      status === "renamed" ? (renameFrom ?? oldPath ?? undefined) : undefined,
    status,
    additions,
    deletions,
    patch: section,
  };
}
```

Context policy: distant return values are no longer required. Preserve enclosing
signatures and closing delimiters; return boundaries require a change inside the
return expression. The updated case assertions reflect this rule.
