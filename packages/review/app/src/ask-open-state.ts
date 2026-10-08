import { AgentSelectionSchema } from "@review/agent-selection";
import { askAgentIds } from "@review/ask/thread-state";
import { createContext } from "react";
import { z } from "zod";

import {
  type ReviewClientConfig,
  reviewPreferenceKey,
} from "./host/review-client";
import type { AskPanel, AskView } from "./review-panel-model";
import type { AskRestore, ReviewPanelStore } from "./review-panel-store";
import {
  readReviewUiState,
  reviewUiStateKey,
  writeReviewUiState,
} from "./review-ui-state";

const agentSchema = z.enum(askAgentIds);

/** The board's project, whose boards share the threads on screen. */
export const AskProjectContext = createContext<string | undefined>(undefined);

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
  askColumn: z.number().int().nullable(),
  askWindow: z.number().int().nullable(),
  askAnchor: anchorSchema.nullable(),
  askSize: z.object({ width: z.number(), height: z.number() }).nullable(),
});

/** Threads stay on screen across the boards of one project, and per
 * window; a board in no project keeps its own. */
function openAsksKey(
  config: ReviewClientConfig | null,
  projectId: string | undefined,
) {
  return projectId === undefined
    ? reviewUiStateKey(config, "window", "ask", "open")
    : reviewPreferenceKey("ask", "project", projectId, "open");
}

/** The threads on screen when a board of this project last went, by a
 * switch to another tab or a reload: they show again where they were, and
 * one whose agent still runs carries on. */
export function readOpenAsks(
  config: ReviewClientConfig | null,
  projectId: string | undefined,
): AskRestore | undefined {
  return restoreSchema.safeParse(
    readReviewUiState("window", openAsksKey(config, projectId)),
  ).data;
}

const handoffSchema = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      agent: agentSchema,
      selection: AgentSelectionSchema,
    }),
  ),
});

/** Opens in the column, beside the whiteboard it draws, the conversations
 * this review took over as it was created: an agent started outside any
 * review, as first run's is, carries on here. */
export async function openHandedOffAsks(
  store: ReviewPanelStore,
  fetchReview: (
    endpoint: "/ask/handoff",
    init: RequestInit,
  ) => Promise<Response>,
): Promise<void> {
  const response = await fetchReview("/ask/handoff", { method: "POST" });

  // A review without Ask has no conversations to take over.
  if (!response.ok) return;

  for (const thread of handoffSchema.parse(await response.json()).threads)
    store.getState().openAskView({
      type: "saved",
      threadId: thread.id,
      selection: thread.selection,
      agent: thread.agent,
    });
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

/** Keeps the threads on screen in the window's storage as they change.
 * Leaving the screen, or the canvas going, leaves a thread's agent
 * running. */
export function syncOpenAsks(
  store: ReviewPanelStore,
  config: ReviewClientConfig | null,
  projectId: string | undefined,
): () => void {
  return store.subscribe((state, previous) => {
    const unchanged = (
      ["asks", "askColumn", "askWindow", "askAnchor", "askSize"] as const
    ).every((field) => state[field] === previous[field]);

    if (unchanged) return;

    writeReviewUiState("window", openAsksKey(config, projectId), {
      asks: state.asks.map(remembered),
      askColumn: state.askColumn,
      askWindow: state.askWindow,
      askAnchor: state.askAnchor,
      askSize: state.askSize,
    } satisfies AskRestore);
  });
}
