import { describe, expect, it } from "vitest";

import { extractTraceEventText } from "./index.js";

// These strings are also the text against which authored TraceQuotes validate.
describe("extractTraceEventText", () => {
  it("preserves message text and markdown", () => {
    expect(
      extractTraceEventText({ kind: "user", text: "Explain this.\nPlease." }),
    ).toBe("Explain this.\nPlease.");
    expect(
      extractTraceEventText({ kind: "assistant", markdown: "**Done**\n" }),
    ).toBe("**Done**\n");
    expect(
      extractTraceEventText({ kind: "separator", label: "Next session" }),
    ).toBe("Next session");
  });

  it("joins tool evidence in display order without missing-field gaps", () => {
    expect(
      extractTraceEventText({
        kind: "tool",
        tool: "shell",
        verb: "run",
        title: "Read file",
        command: "cat app.ts",
        input: "",
        output: "first line\nsecond line",
      }),
    ).toBe("Read file cat app.ts first line\nsecond line");
    expect(
      extractTraceEventText({
        kind: "tool",
        tool: "shell",
        verb: "run",
        title: "Pending",
      }),
    ).toBe("Pending");
  });

  it("returns empty text for an absent event", () => {
    expect(extractTraceEventText(undefined)).toBe("");
  });
});
