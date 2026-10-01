import type { ReviewAgentTraceEvent } from "./contracts.js";

// The one text projection of an event. TraceQuote validation matches quotes
// against this text, so any surface that shows event text for quote picking
// must use the same projection.
export function extractTraceEventText(
  event: ReviewAgentTraceEvent | undefined,
): string {
  if (!event) return "";

  if (event.kind === "user") return event.text;

  if (event.kind === "assistant") return event.markdown;

  if (event.kind === "tool") {
    return [event.title, event.command, event.input, event.output]
      .filter(Boolean)
      .join(" ");
  }

  if (event.kind === "separator") return event.label;

  return "";
}
