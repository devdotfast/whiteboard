import {
  AGENT_TRACE_PARSER_VERSION,
  type AgentTraceParseResult,
  extractTraceEventText,
} from "./agent-trace-parser";
import type { NormalizedTrace } from "./trace-corpus";

/** Shared search representation for local transcripts and downloaded objects. */
export function normalizeTrace(
  parsed: AgentTraceParseResult,
  input: {
    repository: string;
    sessionId: string;
    traceName: string;
    subagents: string[];
    source: NormalizedTrace["metadata"]["source"];
  },
): NormalizedTrace {
  return {
    metadata: {
      type: "metadata",
      version: 1,
      parserVersion: AGENT_TRACE_PARSER_VERSION,
      repository: input.repository,
      session: input.sessionId,
      trace: input.traceName,
      harness: parsed.harness,
      title: parsed.title,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      activeMs: parsed.activeMs,
      userTurns: parsed.userTurns,
      toolCalls: parsed.toolCalls,
      subagents: input.subagents,
      source: input.source,
    },
    events: parsed.events.map((event, index) => ({
      type: "event",
      index,
      kind: event.kind,
      text: extractTraceEventText(event),
      event,
    })),
  };
}
