# devdotfast/review #108

Multiline import groups remain paired while one large context object is split. Preserve the complete enclosing function signature as extra context; do not pair a whole old interface with two new interfaces automatically.

[Original PR](https://github.com/devdotfast/review/pull/108) · [Before](before.tsx) · [After](after.tsx) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**lhs · ordinary diff · {'line': 663, 'byte_column': 0} → {'line': 666, 'byte_column': 1}**

```tsx
  return (
    <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
  );
}
```

**rhs · ordinary diff · {'line': 685, 'byte_column': 0} → {'line': 692, 'byte_column': 1}**

```tsx
  return (
    <ReviewActionsContext.Provider value={actions}>
      <ReviewStateContext.Provider value={state}>
        {children}
      </ReviewStateContext.Provider>
    </ReviewActionsContext.Provider>
  );
}
```

## Fold and context selections

Placeholder: Imports

### `folds/0/lhs` · {'line': 0, 'byte_column': 0} → {'line': 42, 'byte_column': 75}

```tsx
import {
  type JsonValue,
  type ReviewCommentAgentActivity,
  type ReviewCommentThreadRecord,
  ReviewDocumentVersionSchema,
  type ReviewDocumentVersionWire,
  type ReviewLocalCommentThread,
  isJsonObject,
  jsonObject,
  jsonString,
  parseZod,
} from "@dev.fast/review-protocol";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AnchorRef } from "../../src/authoring";
import type { SourceLineComment } from "../../src/source-code-types";
import type { CreateReviewCommentInput, ThreadTarget } from "../../src/types";
import { useComments } from "./comments-context";
import { useReviewSession } from "./host/review-session";
import {
  buildAnchorTextTarget,
  buildCodeTarget,
  projectCodeTarget,
  resolvedCodeSurface,
} from "./target-fingerprint";
import {
  type ReviewSessionCommits,
  anchorTargetRecords,
  buildThreadTargetIndex,
  exactTargetRecords,
  targetAppearsInAnchor,
} from "./thread-target-index";
import { useResolvedBaseRef, useResolvedHeadRef } from "./thread-target-model";
import { captureUiEvent, reviewAppTelemetryHeaders } from "./ui-telemetry";
```

### `folds/0/rhs` · {'line': 0, 'byte_column': 0} → {'line': 42, 'byte_column': 75}

```tsx
import {
  type JsonValue,
  type ReviewCommentAgentActivity,
  type ReviewCommentThreadRecord,
  ReviewDocumentVersionSchema,
  type ReviewDocumentVersionWire,
  type ReviewLocalCommentThread,
  isJsonObject,
  jsonObject,
  jsonString,
  parseZod,
} from "@dev.fast/review-protocol";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AnchorRef } from "../../src/authoring";
import type { SourceLineComment } from "../../src/source-code-types";
import type { CreateReviewCommentInput, ThreadTarget } from "../../src/types";
import { useComments } from "./comments-context";
import { useReviewSession } from "./host/review-session";
import {
  buildAnchorTextTarget,
  buildCodeTarget,
  projectCodeTarget,
  resolvedCodeSurface,
} from "./target-fingerprint";
import {
  type ReviewSessionCommits,
  anchorTargetRecords,
  buildThreadTargetIndex,
  exactTargetRecords,
  targetAppearsInAnchor,
} from "./thread-target-index";
import { useResolvedBaseRef, useResolvedHeadRef } from "./thread-target-model";
import { captureUiEvent, reviewAppTelemetryHeaders } from "./ui-telemetry";
```

### `context/0/lhs` · {'line': 225, 'byte_column': 0} → {'line': 239, 'byte_column': 4}

```tsx
function ReviewCoordinator({
  documentRoute,
  softwareMapEnabled,
  openTraceSession,
  children,
}: {
  documentRoute?: string;
  softwareMapEnabled: boolean;
  openTraceSession?: (input: {
    sessionId: string;
    trace?: string;
    eventIndex?: number;
  }) => void;
  children: ReactNode;
}) {
```

### `context/0/rhs` · {'line': 231, 'byte_column': 0} → {'line': 245, 'byte_column': 4}

```tsx
function ReviewCoordinator({
  documentRoute,
  softwareMapEnabled,
  openTraceSession,
  children,
}: {
  documentRoute?: string;
  softwareMapEnabled: boolean;
  openTraceSession?: (input: {
    sessionId: string;
    trace?: string;
    eventIndex?: number;
  }) => void;
  children: ReactNode;
}) {
```
