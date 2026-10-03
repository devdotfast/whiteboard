import { AgentSelectionSchema } from "@review/agent-selection";
import { askAgentIds } from "@review/ask/thread-state";
import { z } from "zod";

import type { ReviewClientConfig } from "./host/review-client";
import type { AskPanel, AskView } from "./review-panel-model";
import type { AskRestore, ReviewPanelStore } from "./review-panel-store";
import {
  readReviewUiState,
  reviewUiStateKey,
  writeReviewUiState,
} from "./review-ui-state";

const agentSchema = z.enum(askAgentIds);

const viewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("new"),
    selection: AgentSelectionSchema,
    agent: agentSchema.optional(),
  }),
  z.object({
    type: z.literal("saved"),
    threadId: z.string(),
    selection: AgentSelectionSchema,
    agent: agentSchema,
  }),
  z.object({
    type: z.literal("history"),
    passage: z
      .object({ quote: z.string(), threadIds: z.array(z.string()) })
      .optional(),
  }),
]);

const anchorSchema = z.object({
  x: z.enum(["left", "right"]),
  y: z.enum(["top", "bottom"]),
  dx: z.number(),
  dy: z.number(),
});

const restoreSchema = z.object({
  asks: z.array(z.object({ key: z.number().int(), view: viewSchema })),
  askDocked: z.number().int().nullable(),
  askWindow: z.number().int().nullable(),
  askPlace: z.enum(["docked", "window"]),
  askAnchor: anchorSchema.nullable(),
  askSize: z.object({ width: z.number(), height: z.number() }).nullable(),
});

function openAsksKey(config: ReviewClientConfig | null) {
  return reviewUiStateKey(config, "window", "ask", "open");
}

/** The Asks open in this review when its canvas last went, by a switch to
 * another tab or a reload: they open again where they were, and a
 * conversation whose agent still runs carries on. */
export function readOpenAsks(
  config: ReviewClientConfig | null,
): AskRestore | undefined {
  return restoreSchema.safeParse(
    readReviewUiState("window", openAsksKey(config)),
  ).data;
}

/** What to remember of an open Ask: a question asked becomes its
 * conversation, to reopen. */
function remembered({ key, view, threadId, presence }: AskPanel): {
  key: number;
  view: AskView;
} {
  return threadId && view.type === "new"
    ? {
        key,
        view: {
          type: "saved",
          threadId,
          selection: view.selection,
          agent: presence.agent ?? view.agent ?? "claude",
        },
      }
    : { key, view };
}

/**
 * Keeps this review's open Asks in the window's storage as they change, and
 * ends the agent of each Ask that closes, or that another takes the place
 * of. An Ask that only goes with its canvas leaves its agent running.
 */
export function syncOpenAsks(
  store: ReviewPanelStore,
  config: ReviewClientConfig | null,
  close: (threadId: string) => void,
): () => void {
  return store.subscribe((state, previous) => {
    const unchanged = (
      [
        "asks",
        "askDocked",
        "askWindow",
        "askPlace",
        "askAnchor",
        "askSize",
      ] as const
    ).every((field) => state[field] === previous[field]);

    if (unchanged) return;

    for (const gone of previous.asks)
      if (
        gone.threadId &&
        !state.asks.some((ask) => ask.threadId === gone.threadId)
      )
        close(gone.threadId);

    writeReviewUiState("window", openAsksKey(config), {
      asks: state.asks.map(remembered),
      askDocked: state.askDocked,
      askWindow: state.askWindow,
      askPlace: state.askPlace,
      askAnchor: state.askAnchor,
      askSize: state.askSize,
    } satisfies AskRestore);
  });
}
