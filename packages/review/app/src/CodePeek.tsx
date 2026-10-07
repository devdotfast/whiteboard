import type {
  ReviewDiffSide,
  ReviewInlineEditorHeightMode,
  ReviewInlineEditorRange,
} from "@dev.fast/review-protocol";
import {
  type DiffSelection,
  selectionKey,
  sourceAnchor,
  sourcePinsKey,
} from "@review/lens-selection";
import { type FileLineRange, codePeekSource } from "@review/source";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef } from "react";

import { DocumentCodeView } from "./DocumentCodeView";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { codeInspectorMarker, documentMarker } from "./markers.stylex";
import { peekResolutionOutcome } from "./peek-telemetry";
import { type ReviewLensView, useReviewLenses } from "./review-lenses";
import type { SourcePeekAnchor } from "./review-panel-model";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { captureUiEvent } from "./ui-telemetry";

/** The software-map inspector's peek input: a range on one diff side. */
export interface CodePeekProps {
  file: string;
  fromLine: number;
  toLine: number;
  graph?: "head" | "base";
  lenses?: ReviewLensView;
}

export interface CodePeekSubject {
  title: string;
  file: string;
  line: number;
  endLine: number;
}

// Internal interactive surface used by the software-map inspector. Authored
// Review documents receive ReviewCodePeek instead.
export function CodePeek(props: CodePeekProps) {
  const source = useMemo(() => codePeekSource(props), [props]);

  return (
    <FileSnippetCard
      source={source}
      heightMode="content"
      lenses={props.lenses}
    />
  );
}

interface GroupedCodePeek {
  key: string;
  file: string;
  side: ReviewDiffSide;
  ranges: ReviewInlineEditorRange[];
  countRanges?: ReviewInlineEditorRange[];
}

interface AuthoredCodePeekRange extends ReviewInlineEditorRange {
  side: ReviewDiffSide;
}

export function CodePeekGroup({
  peeks,
  collapsed = false,
  lenses,
}: {
  peeks: readonly FileLineRange[];
  collapsed?: boolean;
  lenses?: ReviewLensView;
}) {
  const session = useReviewSession();

  const groups = useMemo(() => groupedCodePeeks(peeks), [peeks]);

  return (
    <>
      {groups.map((group) => {
        const primaryRange = group.ranges[0]!;

        return (
          <section
            key={group.key}
            {...withClass("code-peek", styles.peek)}
            data-code-rendering="inline-editor"
          >
            <DocumentCodeView
              path={group.file}
              title={group.file}
              side={group.side}
              ranges={group.ranges}
              heightMode="content"
              countRanges={group.countRanges}
              active={false}
              collapsed={collapsed}
              lenses={lenses}
              onOpen={() =>
                session.surface.revealAnchor(
                  group.file,
                  {
                    fromLine: primaryRange.startLine,
                    toLine: primaryRange.endLine,
                  },
                  primaryRange.side ?? group.side,
                )
              }
            />
          </section>
        );
      })}
    </>
  );
}

export function ReviewCodePeek({ anchor }: { anchor: SourcePeekAnchor }) {
  return <CodePeekCard source={anchor.peek} />;
}

interface CodePeekCardOptions {
  active?: boolean;
  heightMode?: ReviewInlineEditorHeightMode;
  onNativeFocus?: () => void;
  lenses?: ReviewLensView;
  /** Report resolution telemetry. Only the panel the user opened sets this,
   * so an authored document with many inline peeks sends one event, not N. */
  reportOutcome?: boolean;
}

/** A document peek is an interval of the same alignment used by diff lenses. */
export function CodePeekCard({
  source,
  ...options
}: CodePeekCardOptions & { source: DiffSelection }) {
  const sources = useMemo(() => [source], [source]);

  return <CodePeekFileCard sources={sources} {...options} />;
}

/** Several chunks, one card per file: chunks in the same file share a card so
 * its lens folds the code between them. */
export function CodePeekStack({
  sources,
  ...options
}: CodePeekCardOptions & { sources: readonly DiffSelection[] }) {
  const groups = useMemo(() => codePeekFileGroups(sources), [sources]);

  return (
    <div {...withClass("code-peek-stack", styles.stack)}>
      {groups.map((group) => (
        <CodePeekFileCard
          key={group.map(selectionKey).join("\n")}
          sources={group}
          {...options}
        />
      ))}
    </div>
  );
}

/** Chunks group by file, diff side and pins, in the order each group first
 * appears. */
export function codePeekFileGroups(
  sources: readonly DiffSelection[],
): DiffSelection[][] {
  const groups = new Map<string, DiffSelection[]>();

  for (const source of sources) {
    const key = JSON.stringify([
      source.file,
      sourceAnchor(source).side,
      source.pins ? sourcePinsKey(source.pins) : null,
    ]);

    groups.set(key, [...(groups.get(key) ?? []), source]);
  }

  return [...groups.values()];
}

/** Every source names the same file, side and pins; the first one anchors
 * the card's jump-to-source. */
function CodePeekFileCard({
  sources,
  active = false,
  heightMode = "capped",
  onNativeFocus,
  lenses: lensesOverride,
  reportOutcome = false,
}: CodePeekCardOptions & { sources: readonly DiffSelection[] }) {
  const session = useReviewSession();
  const contextLenses = useReviewLenses();
  const lenses = lensesOverride ?? contextLenses;
  const resolved = lenses?.resolve(sources) ?? [];
  const source = sources[0]!;
  const anchor = sourceAnchor(source);

  const ranges = resolved.map((range) => ({
    side: range.side,
    startLine: range.fromLine,
    endLine: range.toLine,
  }));

  const key = sources.map(selectionKey).join("\n");

  const outcome = peekResolutionOutcome({
    resolvedCount: ranges.length,
    complete: Boolean(lenses?.progress?.complete),
    unavailable: sources.some(
      (item) => lenses?.progress?.unavailableSelections?.[selectionKey(item)],
    ),
    error: Boolean(lenses?.error),
  });

  const reportedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!reportOutcome || outcome === "pending" || reportedKey.current === key)
      return;
    reportedKey.current = key;
    captureUiEvent(
      session,
      outcome === "resolved" ? "peek_resolved" : "peek_resolve_failed",
      { root_kind: "range" },
    );
  }, [key, outcome, reportOutcome, session]);

  if (!ranges.length)
    return (
      <section
        {...withClass("code-peek", styles.peek, drawStyles.blockChild)}
        role="status"
      >
        {outcome === "failed"
          ? "Diff selection unavailable"
          : "Loading diff selection…"}
      </section>
    );

  return (
    <section
      {...withClass("code-peek", styles.peek, drawStyles.blockChild)}
      data-code-rendering="inline-editor"
    >
      <DocumentCodeView
        path={source.file}
        title={codePeekSelectionTitle(sources)}
        side={anchor.side}
        pins={source.pins}
        ranges={ranges}
        countRanges={ranges}
        heightMode={heightMode}
        active={active}
        onFocus={onNativeFocus}
        onOpen={() =>
          session.surface.revealAnchor(
            anchor.file,
            { fromLine: anchor.fromLine, toLine: anchor.toLine },
            anchor.side,
            source.pins,
          )
        }
      />
    </section>
  );
}

/** One-sided chunks list their line ranges; a chunk that spans both sides
 * leaves only the path. */
function codePeekSelectionTitle(sources: readonly DiffSelection[]): string {
  const file = sources[0]!.file;

  if (sources.some((source) => source.start.side !== source.end.side))
    return file;

  const lines = sources.map(({ start, end }) =>
    start.line === end.line ? `${start.line}` : `${start.line}-${end.line}`,
  );

  return `${file}:${lines.join(", ")}`;
}

function FileSnippetCard({
  source,
  active = false,
  heightMode = "capped",
  onNativeFocus,
  lenses,
}: {
  source: FileLineRange;
  active?: boolean;
  heightMode?: ReviewInlineEditorHeightMode;
  onNativeFocus?: () => void;
  lenses?: ReviewLensView;
}) {
  const session = useReviewSession();

  const subject = useMemo(() => codePeekSubject(source), [source]);

  const onNativeFocusRef = useRef(onNativeFocus);
  onNativeFocusRef.current = onNativeFocus;

  return (
    <section
      {...withClass("code-peek", styles.peek, drawStyles.blockChild)}
      data-code-rendering="inline-editor"
    >
      <DocumentCodeView
        path={subject.file}
        title={subject.title}
        side={source.side}
        pins={source.pins}
        ranges={[{ startLine: subject.line, endLine: subject.endLine }]}
        heightMode={heightMode}
        active={active}
        lenses={lenses}
        onFocus={() => onNativeFocusRef.current?.()}
        onOpen={() =>
          session.surface.revealAnchor(
            subject.file,
            { fromLine: subject.line, toLine: subject.endLine },
            source.side,
            source.pins,
          )
        }
      />
    </section>
  );
}

export function codePeekSubject(source: FileLineRange): CodePeekSubject {
  return {
    title: codePeekRangeTitle(source.file, source.fromLine, source.toLine),
    file: source.file,
    line: source.fromLine,
    endLine: source.toLine,
  };
}

// The card header prints one label, and it elides from the left. So give it the
// whole path. A narrow card then keeps the deepest folders and the file name.
function codePeekRangeTitle(
  file: string,
  fromLine: number,
  toLine: number,
): string {
  const range = fromLine === toLine ? `${fromLine}` : `${fromLine}-${toLine}`;

  return `${file}:${range}`;
}

function groupedCodePeeks(peeks: readonly FileLineRange[]): GroupedCodePeek[] {
  const groups = new Map<
    string,
    Omit<GroupedCodePeek, "ranges"> & {
      ranges: AuthoredCodePeekRange[];
    }
  >();

  for (const peek of peeks) {
    const key = peek.file;
    let group = groups.get(key);

    if (!group) {
      group = {
        key,
        file: peek.file,
        side: peek.side,
        ranges: [],
      };
      groups.set(key, group);
    } else if (peek.side === "head") {
      group.side = "head";
    }

    group.ranges.push({
      startLine: peek.fromLine,
      endLine: peek.toLine,
      side: peek.side,
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    countRanges: group.ranges,
    ranges: mergedCodePeekRanges(group.ranges, group.side),
  }));
}

function mergedCodePeekRanges(
  ranges: readonly AuthoredCodePeekRange[],
  defaultSide: ReviewDiffSide,
): ReviewInlineEditorRange[] {
  const merged: ReviewInlineEditorRange[] = [];

  const sides: readonly ReviewDiffSide[] =
    defaultSide === "head" ? ["head", "base"] : ["base", "head"];

  for (const side of sides) {
    const sideRanges = ranges
      .filter((range) => range.side === side)
      .sort((left, right) => left.startLine - right.startLine);

    const mergedForSide: AuthoredCodePeekRange[] = [];

    for (const range of sideRanges) {
      const previous = mergedForSide.at(-1);

      if (!previous || range.startLine > previous.endLine + 1) {
        mergedForSide.push({ ...range });
      } else {
        previous.endLine = Math.max(previous.endLine, range.endLine);
      }
    }

    for (const range of mergedForSide) {
      const compactRange: ReviewInlineEditorRange = {
        startLine: range.startLine,
        endLine: range.endLine,
      };

      if (side !== defaultSide) compactRange.side = side;
      merged.push(compactRange);
    }
  }

  return merged;
}

const narrow = "@media (max-width: 720px)";

const inDocument = () => stylex.when.ancestor(":is(*)", documentMarker);

// A block in a Review document shares the prose column.
const inDocumentBlock = () => `${inDocument()}:is([data-review-node-id] > *)`;

const inMapInspector = () =>
  stylex.when.ancestor(":is(*)", codeInspectorMarker);

// Peeks keep the `code-peek` class: document-embed-scroll.ts finds embeds by it.
const styles = stylex.create({
  peek: {
    width: {
      default: null,
      [inDocumentBlock()]: `min(100%, ${tokens.reviewBlockMaxWidth})`,
    },
    minWidth: 0,
    maxWidth: {
      default: "100%",
      [inDocumentBlock()]: `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`,
    },
    marginInline: { default: null, [inDocumentBlock()]: "auto" },
    marginBlock: { default: "24px", [inMapInspector()]: 0 },
    overflow: { default: null, [inMapInspector()]: "visible" },
    padding: {
      default: null,
      [inMapInspector()]: { default: 0, [narrow]: "0 8px 8px" },
    },
    overscrollBehavior: {
      default: null,
      [inMapInspector()]: { default: null, [narrow]: "contain" },
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
  },
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    minWidth: 0,
  },
});
