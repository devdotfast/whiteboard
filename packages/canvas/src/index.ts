import type { ReactElement, ReactNode } from "react";

declare const data: unique symbol;

declare const host: unique symbol;

declare const map: unique symbol;

export interface WhiteboardData {
  readonly [data]: true;
}

export interface WhiteboardHost {
  readonly [host]: true;
}

export interface WhiteboardSettings {
  softwareMapEnabled?: boolean;
  documentWidth?: "standard" | "wide" | "full";
}

/** Render it inside an element with the `review-canvas-root` class.
 * With `activity`, a new `version`'s `lastEdit` animates and the courier moves. */
export declare function WhiteboardProvider(props: {
  data: WhiteboardData;
  host: WhiteboardHost;
  settings: WhiteboardSettings;
  children?: ReactNode;
}): ReactElement;

export declare function Whiteboard(): ReactElement;

export declare function ReviewTopBar(): ReactElement;

export interface ShareView {
  title: string;
  /** Present when Desktop can import the share. */
  repository?: { cloneUrl: string };
  data: WhiteboardData;
  host: WhiteboardHost;
  dispose(): void;
}

/** Opens a review-share/2 bundle, as parsed JSON, and validates it; a
 * server can render the board and the client hydrate it. `theme` defaults
 * to "system", the viewer's preference, and holds for the view's life.
 * `wasmUrl` defaults to the routing wasm shipped beside this module.
 * Images are not shared yet. */
export declare function openShare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Share boundary: openShare parses the bundle.
  bundle: unknown,
  options?: { theme?: "light" | "dark" | "system"; wasmUrl?: string },
): Promise<ShareView>;

/** The edit that produced a version, as Whiteboard's store records it. */
export interface BoardEdit {
  type: string;
  targetId: string;
  /** The block the target belongs to: itself, or a unit's diagram. */
  blockId: string;
  kind: string;
  unit?: string;
  linkId?: string;
  fields?: string[];
  units?: string[];
  activityId?: string;
  threadId?: string;
}

/** The agents working on a board. */
export interface BoardActivity {
  workingCount: number;
  expiresAt: number | null;
  activities?: {
    activityId: string;
    slot: number;
    focus?: { description: string; targetId?: string };
    surface?: "document" | "lenses";
    /** Blocks reserved for it, ringed in its color. */
    hold?: string[];
  }[];
}

/** One saved version of a board. */
export interface BoardSnapshot {
  reviewId: string;
  version: number;
  title: string;
  /** Validated as a Whiteboard document. */
  document: readonly unknown[];
  createdAt: string;
  lastEdit?: BoardEdit;
  /** Present for a live board; "unknown" once its stream is lost. */
  activity?: BoardActivity | "unknown";
}

export interface BoardTrace {
  label: string;
  events: { id: string; role: string; text: string }[];
}

/** A saved software map, as a share bundle carries it. */
export interface BoardMap {
  readonly [map]: true;
}

export interface BoardViewOptions {
  /** By asset id; read from blob URLs the caller revokes. */
  images?: Record<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>;
  /** By trace id. */
  traces?: Record<string, BoardTrace>;
  /** By map version id. */
  maps?: Record<string, BoardMap>;
  commits?: readonly object[];
  /** The board's resolved selections, for a host that cannot read them. */
  progress?: object;
}

/** Reads one version into board data; throws on an invalid document.
 * Pass each version in turn so its `lastEdit` animates. */
export declare function boardView(
  snapshot: BoardSnapshot,
  options?: BoardViewOptions,
): WhiteboardData;

/** A host that reads and edits nothing; source peeks show no lines.
 * `theme` defaults to "system" and `wasmUrl` to the shipped routing wasm. */
export declare function readOnlyHost(options?: {
  theme?: "light" | "dark" | "system";
  wasmUrl?: string;
}): WhiteboardHost & { dispose(): void };
