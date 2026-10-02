import type {
  ActivitySnapshot,
  ActivitySurface,
} from "@review/review-api/activity";
import type { EditSummary } from "@review/review-api/document";

/**
 * Where the agent is on the board. The stream carries two signals: the edit
 * that produced each version, and each agent's focus. A new version moves the
 * cursor to what it edited; between versions, a changed focus moves it to
 * what the agent says it is looking at. `seq` counts moves, so two edits to
 * the same target still read as two arrivals. A reader who joins mid-session
 * finds him standing on the last edit, already drawn.
 *
 * Each surface has its own cursor: the document's courier follows document
 * edits and the focus of the agent writing there, the Diffs page's follows
 * lens edits and the lens agent's focus. One stream feeds both.
 */
export interface AuthoringCursor {
  targetId: string;
  /** The block the target belongs to: itself, or a unit's diagram. */
  blockId: string;
  /** `standing`: the edit was on the board before the reader arrived, so
   * the courier stands on it and nothing is drawn. */
  source: "edit" | "focus" | "standing";
  edit?: EditSummary;
  seq: number;
}

export interface CursorMessage {
  version: number;
  lastEdit?: EditSummary;
  activity: ActivitySnapshot | "unknown";
}

/** What the fold remembers between messages; the caller keeps one per stream. */
export interface CursorMemory {
  version?: number;
  focusTarget?: string;
}

/** The surface an edit belongs to: a lens edit is drawn on the Diffs page. */
export const editScope = (edit: EditSummary): ActivitySurface =>
  edit.kind === "lens" ? "lenses" : "document";

/** Where an agent is: where it last wrote, the document until it writes. */
export const surfaceOf = (presence: { surface?: ActivitySurface }) =>
  presence.surface ?? "document";

/** The agent working on one surface. */
export function scopePresence(
  activity: ActivitySnapshot | "unknown" | undefined,
  scope: ActivitySurface,
) {
  if (activity === undefined || activity === "unknown") return undefined;

  return activity.activities?.find((presence) => surfaceOf(presence) === scope);
}

/** The focus of the agent working on one surface. */
export function scopeFocus(activity: ActivitySnapshot, scope: ActivitySurface) {
  return scopePresence(activity, scope)?.focus;
}

/** Whether an agent is working on one surface. */
export function scopeLive(
  activity: ActivitySnapshot | "unknown" | undefined,
  scope: ActivitySurface,
): boolean {
  if (activity === undefined || activity === "unknown") return false;

  return (activity.activities ?? []).some(
    (presence) => surfaceOf(presence) === scope,
  );
}

/** Fold one stream message into one scope's cursor; the memory is the
 * caller's, one per scope. */
export function nextCursor(
  cursor: AuthoringCursor | null,
  memory: CursorMemory,
  message: CursorMessage,
  scope: ActivitySurface = "document",
): AuthoringCursor | null {
  const seq = (cursor?.seq ?? 0) + 1;

  const focusTarget =
    message.activity === "unknown"
      ? memory.focusTarget
      : scopeFocus(message.activity, scope)?.targetId;

  // Another scope's edit is not this courier's to draw.
  const lastEdit =
    message.lastEdit && editScope(message.lastEdit) === scope
      ? message.lastEdit
      : undefined;

  const first = memory.version === undefined;
  const versionChanged = !first && memory.version !== message.version;

  memory.version = message.version;

  // The document as found: the courier starts on its last edit, unless the
  // agent already names what it is looking at.
  if (first && lastEdit && !focusTarget)
    return {
      targetId: lastEdit.targetId,
      blockId: lastEdit.blockId,
      source: "standing",
      edit: lastEdit,
      seq,
    };

  if (versionChanged && lastEdit) {
    // The edit has the agent's attention: a focus set before it is spent.
    memory.focusTarget = focusTarget;

    return {
      targetId: lastEdit.targetId,
      blockId: lastEdit.blockId,
      source: "edit",
      edit: lastEdit,
      seq,
    };
  }

  if (focusTarget !== memory.focusTarget) {
    memory.focusTarget = focusTarget;

    if (focusTarget)
      return {
        targetId: focusTarget,
        blockId: focusTarget,
        source: "focus",
        seq,
      };
  }

  return cursor;
}
