import type {
  ReviewAskMark,
  ReviewDiffViewHandle,
  ReviewInlineEditorHandle,
} from "@dev.fast/review-protocol";
import type { AskHistoryEntry } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { AGENT_LOGOS } from "./agent-logos";
import { useAskHistory } from "./ask-history";
import { openAskConversations, truncate } from "./ask-marks";
import { useOptionalReviewPanelStore } from "./review-panel";
import { fontSize, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

interface CodeMark extends ReviewAskMark {
  /** Newest first, like the history. */
  entries: AskHistoryEntry[];
}

type CodeTarget = Extract<
  AskHistoryEntry["selection"]["target"],
  { kind: "code" }
>;

/** The asked-about lines' text, from the diff rows saved with the Ask. */
export function askedText(
  target: CodeTarget,
  diff: AskHistoryEntry["selection"]["selectedDiff"],
): string[] | undefined {
  if (!diff) return undefined;
  const other = target.side === "base" ? "added" : "deleted";
  const lines = new Map<number, string>();
  let line = target.side === "base" ? diff.oldStart : diff.newStart;

  for (const row of diff.rows)
    if (row.kind !== other) lines.set(line++, row.text);

  const text: string[] = [];

  for (let at = target.startLine; at <= target.endLine; at++) {
    const row = lines.get(at);

    if (row === undefined) return undefined;
    text.push(row);
  }

  return text;
}

/** Asks from the same commit's diff, or from the review's own. */
function codeMarks(
  entries: readonly AskHistoryEntry[],
  commit: string | undefined,
): CodeMark[] {
  const marks = new Map<string, CodeMark>();

  for (const entry of entries) {
    const { target, apiSource } = entry.selection;

    if (target.kind !== "code" || apiSource?.commit !== commit) continue;
    const id = `${target.path}:${target.side}:${target.startLine}:${target.endLine}`;
    const mark = marks.get(id);

    if (mark) mark.entries.push(entry);
    else
      marks.set(id, {
        id,
        file: target.path,
        side: target.side,
        fromLine: target.startLine,
        toLine: target.endLine,
        text: askedText(target, entry.selection.selectedDiff),
        entries: [entry],
      });
  }

  return [...marks.values()];
}

/** Pins saved Ask conversations in the gutter of a diff or code peek,
 * beside the lines they asked about; a pin reopens them. */
export function AskCodePins({
  handle,
  commit,
}: {
  handle: ReviewDiffViewHandle | ReviewInlineEditorHandle | null;
  commit?: string;
}): ReactElement {
  const entries = useAskHistory()?.entries;

  const marks = useMemo(
    () => codeMarks(entries ?? [], commit),
    [entries, commit],
  );

  const [nodes, setNodes] = useState<ReadonlyMap<HTMLElement, string>>(
    () => new Map(),
  );

  useLayoutEffect(() => {
    handle?.setAskMarks?.(marks, (id, node) => {
      setNodes((before) => new Map(before).set(node, id));

      return () =>
        setNodes((before) => {
          const after = new Map(before);

          after.delete(node);

          return after;
        });
    });
  }, [handle, marks]);

  const byId = useMemo(
    () => new Map(marks.map((mark) => [mark.id, mark])),
    [marks],
  );

  return (
    <>
      {[...nodes].map(([node, id]) => {
        const mark = byId.get(id);

        return mark ? createPortal(<CodePin mark={mark} />, node, id) : null;
      })}
    </>
  );
}

function CodePin({ mark }: { mark: CodeMark }): ReactElement {
  const panels = useOptionalReviewPanelStore();
  const [newest] = mark.entries;
  const count = mark.entries.length;
  const question = newest?.question ?? newest?.title ?? "";

  const lines =
    mark.fromLine === mark.toLine
      ? `line ${mark.fromLine}`
      : `lines ${mark.fromLine}–${mark.toLine}`;

  const tooltip = useTooltip(
    count === 1
      ? truncate(question, 120)
      : `${count} conversations · ${truncate(question, 100)}`,
    { quick: true },
  );

  return (
    <button
      ref={tooltip}
      type="button"
      {...stylex.props(styles.pin)}
      aria-label={
        count === 1
          ? `Open the conversation about ${mark.file} ${lines}`
          : `${count} conversations about ${mark.file} ${lines}`
      }
      onClick={() =>
        openAskConversations(
          panels,
          mark.entries,
          newest?.selection.title ?? mark.file,
        )
      }
    >
      {newest ? AGENT_LOGOS[newest.agent]({ xstyle: styles.logo }) : null}
      {count > 1 ? count : null}
    </button>
  );
}

const styles = stylex.create({
  // Spans both gutter lanes.
  pin: {
    position: "absolute",
    top: 0,
    left: "1px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "3px",
    width: "calc(200% - 2px)",
    height: "100%",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.ruleSoft,
      ":hover": tokens.accent,
      ":focus-visible": tokens.accent,
    },
    borderRadius: radius.control,
    backgroundColor: {
      default: tokens.raised,
      ":hover": tokens.accentSoft,
      ":focus-visible": tokens.accentSoft,
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: 1,
    cursor: "pointer",
    outline: "none",
  },
  logo: {
    flexShrink: 0,
    width: "16px",
    height: "16px",
  },
});
