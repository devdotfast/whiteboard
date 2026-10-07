# devdotfast/review #160

A genuinely new file: head-only multiline imports and a supplied replacement for the export function body. Keep the multiline signature visible. No extra context is emitted because the whole file is added.

[Original PR](https://github.com/devdotfast/review/pull/160) · [Before](before.ts) · [After](after.ts) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**rhs · ordinary diff · {'line': 35, 'byte_column': 0} → {'line': 38, 'byte_column': 28}**

```typescript
export async function exportOpenCodeTrace(input: {
  sessionId: string;
  root: string;
}): Promise<string | null> {
```

**rhs · ordinary diff · {'line': 67, 'byte_column': 0} → {'line': 67, 'byte_column': 21}**

```typescript
  return destination;
```

**rhs · ordinary diff · {'line': 67, 'byte_column': 0} → {'line': 68, 'byte_column': 1}**

```typescript
  return destination;
}
```

## Fold and context selections

Placeholder: Imports

### `folds/0/rhs` · {'line': 0, 'byte_column': 0} → {'line': 18, 'byte_column': 35}

```typescript
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  type JsonObject,
  type JsonValue,
  jsonArray,
  jsonObject,
  parseJsonText,
} from "@dev.fast/review-protocol";
```

Placeholder: Export the session, validate its records, and atomically write the trace.

### `folds/1/rhs` · {'line': 39, 'byte_column': 0} → {'line': 66, 'byte_column': 35}

```typescript
  mkdirSync(input.root, { recursive: true });
  const destination = path.join(input.root, `${input.sessionId}.jsonl`);
  const staging = `${destination}.tmp-${process.pid}`;
  const raw = await runOpenCodeExport(input.sessionId, `${staging}.json`);
  if (raw === null) return null;
  const exported = jsonObject(parseJsonText(raw));
  const info = jsonObject(exported?.info);
  if (!exported || !info) {
    throw new Error(
      `opencode export ${input.sessionId} returned no session info.`,
    );
  }
  const messages = jsonArray(exported.messages);
  if (!messages) {
    throw new Error(
      `opencode export ${input.sessionId} returned no message list.`,
    );
  }
  const header: JsonObject = {
    type: OPENCODE_SESSION_RECORD,
    ...pick(info, ["id", "parentID", "directory", "title", "version", "time"]),
  };
  const lines = [
    JSON.stringify(header),
    ...messages.map((message) => JSON.stringify(traceMessageRecord(message))),
  ];
  writeFileSync(staging, `${lines.join("\n")}\n`, "utf8");
  renameSync(staging, destination);
```
