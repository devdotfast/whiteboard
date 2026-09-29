import { Button } from "@canvas/ui/button";
import { Chip } from "@canvas/ui/chip";
import { surfaceStyles } from "@canvas/ui/surface";
import { textStyles } from "@canvas/ui/text";
import { fieldStyles } from "@canvas/ui/text-field";
import { type ReviewAgentTraceSession } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";

import { useReviewSession } from "./host/review-session";
import type { TraceSelection } from "./review-panel-store";
import { ChevronIcon, TraceDocument, formatDuration } from "./trace-document";
import { TraceRuler } from "./trace-ruler";
import { traceStyles as styles } from "./trace-styles";
import {
  type AgentTraceStorage,
  type LoadedAgentTrace,
  makeAgentTraceKey,
  useAgentTrace,
} from "./use-agent-trace";
import { type TraceListState, useTraceList } from "./use-trace-list";

export function ReviewTraceView({
  selection,
  onSelect,
  storedList: providedList,
}: {
  selection?: TraceSelection;
  onSelect: (selection: TraceSelection) => void;
  storedList?: TraceListState;
}) {
  const session = useReviewSession();

  const selectedKey = selection
    ? makeAgentTraceKey(selection.sessionId, selection.trace)
    : null;

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Read override only; capture and consent are unchanged.
  const [storageOverride, setStorageOverride] =
    useState<AgentTraceStorage | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target;

      if (
        pickerRef.current &&
        target instanceof Node &&
        !pickerRef.current.contains(target)
      ) {
        setPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [pickerOpen]);

  const storedList = useTraceList(storageOverride, providedList);

  const list: TraceListState = useMemo(() => {
    const retained = [
      ...new Map(
        [...(session.review?.traces.values() ?? [])].map((trace) => [
          trace.session.sessionId,
          trace.session,
        ]),
      ).values(),
    ];

    if (storedList.status === "loaded") {
      const ids = new Set(retained.map((trace) => trace.sessionId));

      return {
        ...storedList,
        sessions: [
          ...retained,
          ...storedList.sessions.filter((trace) => !ids.has(trace.sessionId)),
        ],
      };
    }

    return retained.length > 0
      ? {
          status: "loaded",
          configured: true,
          storage: null,
          sources: [],
          storageError: storedList.status === "error" ? storedList.error : null,
          sessions: retained,
        }
      : storedList;
  }, [session.review, storedList]);

  const sessions = list.status === "loaded" ? list.sessions : [];

  // Build flat trace targets (main trace + each subagent)
  const targets = useMemo(() => {
    const result: Array<{
      key: string;
      sessionId: string;
      trace?: string;
      title: string;
      harness: ReviewAgentTraceSession["harness"];
      isSubagent?: boolean;
      available: boolean;
      notSynced?: boolean;
      commits: ReviewAgentTraceSession["commits"];
    }> = [];

    for (const s of sessions) {
      const title = s.title || s.commits[0]?.subject || "Agent session";
      result.push({
        key: s.sessionId,
        sessionId: s.sessionId,
        title,
        harness: s.harness,
        available: s.available,
        notSynced: s.notSynced,
        commits: s.commits,
      });

      for (const sub of s.subagents ?? []) {
        const key = `${s.sessionId}:${sub}`;
        result.push({
          key,
          sessionId: s.sessionId,
          trace: sub,
          title: sub,
          harness: s.harness,
          isSubagent: true,
          available: s.available,
          commits: s.commits,
        });
      }
    }

    return result;
  }, [sessions]);

  const activeTarget = useMemo(
    () =>
      targets.find((t) => t.key === selectedKey) ??
      targets.find((t) => t.available) ??
      targets[0] ??
      null,
    [targets, selectedKey],
  );

  const activeKey = activeTarget?.key ?? null;

  const detail = useAgentTrace(
    activeTarget?.sessionId,
    activeTarget?.trace,
    storageOverride,
  );

  // Keep source controls visible during refetch.
  const [sourceChoices, setSourceChoices] = useState<AgentTraceStorage[]>([]);
  useEffect(() => {
    if (list.status === "loaded" && list.sources.length > 0) {
      setSourceChoices(list.sources);
    }
  }, [list]);

  const activeSource =
    storageOverride ?? (list.status === "loaded" ? list.storage : null);

  const activeTrace = detail.status === "loaded" ? detail.trace : undefined;

  const activeHarness =
    activeTrace?.session.harness ?? activeTarget?.harness ?? "unknown";

  const activeTitle = activeTrace?.title ?? activeTarget?.title ?? "";

  return (
    <div {...stylex.props(styles.view)}>
      {detail.status === "loaded" && (
        <TraceRuler events={detail.trace.events} />
      )}
      <div {...stylex.props(styles.column)}>
        {list.status === "loading" && (
          <p {...stylex.props(styles.note)}>Resolving agent sessions…</p>
        )}
        {list.status === "error" && (
          <p {...stylex.props(styles.note, styles.noteError)}>{list.error}</p>
        )}
        {sourceChoices.length > 1 && (
          <label {...stylex.props(styles.source)}>
            <span {...stylex.props(textStyles.eyebrow, styles.kicker)}>
              Trace source
            </span>
            <select
              {...stylex.props(fieldStyles.box)}
              aria-label="Trace source"
              value={activeSource ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setStorageOverride(
                  value === "s3" || value === "hosted" ? value : null,
                );
              }}
            >
              {sourceChoices.map((source) => (
                <option key={source} value={source}>
                  {source === "s3" ? "S3/R2 bucket" : "Hosted store"}
                </option>
              ))}
            </select>
          </label>
        )}
        {list.status === "loaded" &&
          (list.storageError !== null || !list.configured) && (
            <div {...stylex.props(styles.empty)}>
              <span {...stylex.props(textStyles.eyebrow, styles.kicker)}>
                Agent trace
              </span>
              {list.storageError !== null ? (
                <p {...stylex.props(styles.flush)}>{list.storageError}</p>
              ) : (
                <>
                  <p {...stylex.props(styles.flush)}>
                    Agent traces are not configured.
                  </p>
                  <p {...stylex.props(styles.flush, styles.note)}>
                    Open Agent Setup in Whiteboard to enable trace capture.
                  </p>
                </>
              )}
            </div>
          )}
        {list.status === "loaded" &&
          list.configured &&
          list.storageError === null &&
          sessions.length === 0 && (
            <div {...stylex.props(styles.empty)}>
              <span {...stylex.props(textStyles.eyebrow, styles.kicker)}>
                Agent trace
              </span>
              <p {...stylex.props(styles.flush)}>
                No agent sessions are recorded for this change range.
              </p>
              <p {...stylex.props(styles.flush, styles.note)}>
                Sessions attach automatically through{" "}
                <code>Agent-Session:</code> commit trailers when an agent
                commits with repository hooks installed.
              </p>
            </div>
          )}
        {targets.length > 1 && activeTarget && (
          <div {...stylex.props(styles.picker)} ref={pickerRef}>
            <Button
              size="large"
              xstyle={[
                styles.pickerTrigger,
                pickerOpen && styles.pickerTriggerOpen,
              ]}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <span {...stylex.props(textStyles.eyebrow, styles.pickerHarness)}>
                {harnessTag(activeHarness, activeTarget.isSubagent)}
              </span>
              <span {...stylex.props(styles.pickerTitle)}>{activeTitle}</span>
              <span
                {...stylex.props(
                  styles.pickerChevron,
                  pickerOpen && styles.pickerChevronOpen,
                )}
              >
                <ChevronIcon />
              </span>
            </Button>
            {pickerOpen && (
              <div
                {...stylex.props(surfaceStyles.popover, styles.pickerMenu)}
                role="listbox"
              >
                {targets.map((target) => {
                  const isActive = target.key === activeKey;
                  const targetHarness = target.harness;
                  const itemTitle = target.title;

                  return (
                    <button
                      key={target.key}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      {...stylex.props(
                        styles.pickerItem,
                        isActive
                          ? styles.pickerItemActive
                          : target.isSubagent && styles.pickerItemSubagent,
                      )}
                      disabled={!target.available}
                      onClick={() => {
                        onSelect({
                          sessionId: target.sessionId,
                          trace: target.trace,
                        });
                        setPickerOpen(false);
                      }}
                    >
                      <div {...stylex.props(styles.pickerItemLeft)}>
                        <span
                          {...stylex.props(
                            textStyles.eyebrow,
                            styles.pickerItemHarness,
                            isActive && styles.pickerItemHarnessActive,
                          )}
                        >
                          {harnessTag(targetHarness, target.isSubagent)}
                        </span>
                        <span
                          {...stylex.props(
                            styles.pickerItemTitle,
                            isActive && styles.pickerItemTitleActive,
                          )}
                        >
                          {itemTitle}
                        </span>
                      </div>
                      {target.notSynced ? (
                        <Chip xstyle={styles.pickerItemBadge}>not synced</Chip>
                      ) : isActive ? (
                        <span {...stylex.props(styles.pickerItemCheck)}>✓</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {detail.status === "loading" && (
          <p {...stylex.props(styles.note)}>Loading trace…</p>
        )}
        {detail.status === "error" && (
          <p {...stylex.props(styles.note, styles.noteError)}>{detail.error}</p>
        )}
        {detail.status === "loaded" &&
          detail.trace.cacheStatus &&
          detail.trace.cacheStatus !== "current" && (
            <p {...stylex.props(styles.note)}>
              {detail.trace.cacheStatus === "offline"
                ? "Showing a saved copy; the trace store did not answer."
                : "Showing the last saved copy; the latest download failed."}
            </p>
          )}
        {detail.status === "loaded" && (
          <ReviewTraceDocument
            trace={detail.trace}
            session={
              sessions.find(
                (s) => s.sessionId === detail.trace.session.sessionId,
              ) ?? detail.trace.session
            }
            targetEventIndex={
              selectedKey === activeKey ? selection?.eventIndex : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function harnessLabel(harness: ReviewAgentTraceSession["harness"]): string {
  if (harness === "claude-code") return "claude";

  if (harness === "codex") return "codex";

  if (harness === "opencode") return "opencode";

  if (harness === "pi") return "pi";

  return "agent";
}

function harnessTag(
  harness: ReviewAgentTraceSession["harness"],
  isSubagent?: boolean,
): string {
  if (isSubagent) {
    if (harness === "pi") return "PI SUB";

    if (harness === "claude-code") return "CLAUDE SUB";

    if (harness === "codex") return "CODEX SUB";

    if (harness === "opencode") return "OPENCODE SUB";

    return "SUBAGENT";
  }

  if (harness === "pi") return "PI";

  if (harness === "claude-code") return "CLAUDE";

  if (harness === "codex") return "CODEX";

  if (harness === "opencode") return "OPENCODE";

  return "AGENT";
}

export function ReviewTraceDocument({
  trace,
  session,
  targetEventIndex,
  highlightQuote,
}: {
  trace: LoadedAgentTrace;
  session: ReviewAgentTraceSession;
  targetEventIndex?: number;
  highlightQuote?: string;
}) {
  const duration =
    trace.activeMs !== null
      ? formatDuration(trace.activeMs)
      : trace.startedAt && trace.endedAt
        ? formatDuration(
            Date.parse(trace.endedAt) - Date.parse(trace.startedAt),
          )
        : null;

  return (
    <>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(textStyles.eyebrow, styles.kicker)}>
          Agent trace
        </span>
        <h2 {...stylex.props(styles.title)}>
          {trace.title ??
            firstCommitSubject(session) ??
            (trace.trace ? `Subagent: ${trace.trace}` : "Agent session")}
        </h2>
        <div {...stylex.props(styles.meta)}>
          <span>{harnessLabel(trace.session.harness)}</span>
          <span {...stylex.props(styles.metaSeparator)}>·</span>
          <span>{trace.session.sessionId.slice(0, 8)}</span>
          {trace.trace && (
            <>
              <span {...stylex.props(styles.metaSeparator)}>·</span>
              <span>{trace.trace}</span>
            </>
          )}
          <span {...stylex.props(styles.metaSeparator)}>·</span>
          <span>
            {trace.userTurns} {trace.userTurns === 1 ? "turn" : "turns"}
          </span>
          <span {...stylex.props(styles.metaSeparator)}>·</span>
          <span>{trace.toolCalls} tool calls</span>
          {duration && (
            <>
              <span {...stylex.props(styles.metaSeparator)}>·</span>
              <span>worked {duration}</span>
            </>
          )}
        </div>
      </header>
      <TraceDocument
        events={trace.events}
        targetEventIndex={targetEventIndex}
        highlightQuote={highlightQuote}
      />
    </>
  );
}

function firstCommitSubject(session: ReviewAgentTraceSession): string | null {
  return session.commits[0]?.subject ?? null;
}
