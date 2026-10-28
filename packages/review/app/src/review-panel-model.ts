import type { DiffSelection } from "@dev.fast/whiteboard-document";
import type { AgentSelection } from "@review/agent-selection";
import type { AskAgentId } from "@review/ask/thread-state";

export type ReviewPeekContent =
  /** `more` follows `source` for a step with several ranges. */
  | { kind: "source"; source: DiffSelection; more?: DiffSelection[] }
  | { kind: "inline-code"; language?: string; text: string }
  | { kind: "explanation"; text?: string }
  | {
      kind: "trace-quote";
      sessionId: string;
      trace?: string;
      event?: number;
      quote: string;
    };

/** The subject of a peek or tour stop. */
export interface PeekAnchor {
  id: string;
  title: string;
  detail?: string;
  peek?: DiffSelection;
  softwareMapPath?: string;
}

export type SourcePeekAnchor = PeekAnchor & { peek: DiffSelection };

export interface GuidedTourStop {
  anchor: PeekAnchor;
  label: string;
  detail?: string;
  content: ReviewPeekContent;
}

export interface GuidedTour {
  id: string;
  title?: string;
  stops: GuidedTourStop[];
  telemetryKind?: "sequence";
}

export interface PeekPanel {
  kind: "peek";
  anchor?: PeekAnchor;
  content: ReviewPeekContent;
}

/** Asked-about words whose conversations the history lists alone. */
export interface AskPassage {
  quote: string;
  threadIds: string[];
  /** Several passages, folded into one pin's +N; `quote` joins them. */
  several?: boolean;
}

/** What the Ask panel shows: a new question about a selection, a saved
 * conversation, or the list of saved ones, all or those about one passage. */
export type AskView =
  | {
      type: "new";
      selection: AgentSelection;
      /** The agent chosen from the selection toolbar, if any. */
      agent?: AskAgentId;
    }
  | {
      type: "saved";
      threadId: string;
      selection: AgentSelection;
      agent: AskAgentId;
    }
  | {
      type: "history";
      /** Only the conversations about this passage, from its pin. */
      passage?: AskPassage;
    };

/** Who answers in an Ask. */
export interface AskPresence {
  /** Absent for the list of conversations, which has no one agent. */
  agent?: AskAgentId;
  agentName: string;
}

/** One open Ask: a conversation with a local agent about a selection, or
 * the list of saved ones. Each view change remounts it through `key`. */
export interface AskPanel {
  kind: "ask";
  key: number;
  view: AskView;
  /** The conversation it shows, once it has one. */
  threadId: string | null;
  /** Its agent is answering or waiting on the reviewer: closing it stops
   * the agent, so it asks first, and what replaces it floats it in the
   * window. */
  busy: boolean;
  presence: AskPresence;
  /** Opened where the reader is editing, which keeps the caret: its
   * composer waits to be clicked into. */
  unfocused?: true;
}

/** What an open Ask says about itself as its conversation goes. */
export type AskReport = Pick<AskPanel, "threadId" | "busy" | "presence">;

/** How a thread shows: in the column, or in the window over the board that
 * stays above peeks, fullscreen diagrams and every view. */
export type AskShown = "panel" | "window";

/** Where the window floats: a corner of the canvas beside any docked
 * panel, and how far the same corner of the window is from it. Keeping to
 * a corner, it moves aside as a panel docks and follows the canvas as it
 * resizes. */
export interface AskAnchor {
  x: "left" | "right";
  y: "top" | "bottom";
  dx: number;
  dy: number;
}

/** How big the reviewer made Ask's window. */
export interface AskSize {
  width: number;
  height: number;
}

export type ReviewPanelMotion = "live" | "restored";
