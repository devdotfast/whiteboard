import type { AgentSelection } from "@review/agent-selection";
import type { AskAgentId } from "@review/ask/thread-state";
import { type DiffSelection } from "@review/lens-selection";

export type ReviewPeekContent =
  | { kind: "source"; source: DiffSelection }
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
      passage?: { quote: string; threadIds: string[] };
    };

/** What the pill says about a conversation it stands in for. */
export interface AskPresence {
  /** Absent for the list of conversations, which has no one agent. */
  agent?: AskAgentId;
  agentName: string;
  status: string;
  tone: "quiet" | "waiting" | "failed";
}

/** One open Ask: a conversation with a local agent about a selection, or
 * the list of saved ones. Each view change remounts it through `key`. */
export interface AskPanel {
  kind: "ask";
  key: number;
  view: AskView;
  /** The conversation it shows, once it has one. */
  threadId: string | null;
  /** Its agent is working: closing it stops the agent, so it asks first,
   * and a new question opens beside it rather than in its place. */
  busy: boolean;
  presence: AskPresence;
}

/** What an open Ask says about itself as its conversation goes. */
export type AskReport = Pick<AskPanel, "threadId" | "busy" | "presence">;

/** Where Ask shows: in the side panel, or in a window over the canvas that
 * stays above peeks, fullscreen diagrams and every view. One Ask at most
 * shows in each; the others are pills. */
export type AskPlace = "docked" | "window";

/** How an Ask shows now: in the side panel, in the window, or as a pill
 * that says what its agent is doing. A docked Ask that a peek or a
 * fullscreen diagram covers shows as a pill. */
export type AskShown = "panel" | "window" | "pill";

/** Where Ask floats, shared by its window and its pill: a corner of the
 * canvas beside any docked panel, and how far the same corner of the window
 * or pill is from it. Keeping to a corner, Ask moves aside as a panel docks
 * and follows the canvas as it resizes. */
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
