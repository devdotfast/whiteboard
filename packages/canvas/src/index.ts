import type { ReactElement, ReactNode } from "react";

declare const data: unique symbol;

declare const host: unique symbol;

export interface WhiteboardData {
  readonly [data]: true;
}

export interface WhiteboardHost {
  readonly [host]: true;
}

export interface WhiteboardSettings {
  softwareMapEnabled?: boolean;
  sharingEnabled?: boolean;
  documentWidth?: "standard" | "wide" | "full";
}

/** Render it inside an element with the `review-canvas-root` class. */
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
