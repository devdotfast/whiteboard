import type { ReactElement, ReactNode } from "react";

declare const data: unique symbol;

declare const host: unique symbol;

/** A loaded board, ready to draw. Its host builds it. */
export interface WhiteboardData {
  readonly [data]: true;
}

/** What the host can do for the board. Its host builds it. */
export interface WhiteboardHost {
  readonly [host]: true;
}

/** The reader's choices for every board. */
export interface WhiteboardSettings {
  softwareMapEnabled?: boolean;
  sharingEnabled?: boolean;
  documentWidth?: "standard" | "wide" | "full";
}

/** What the top bar and the board share. Render both under it, inside an
 * element with the `review-canvas-root` class. */
export declare function WhiteboardProvider(props: {
  data: WhiteboardData;
  host: WhiteboardHost;
  settings: WhiteboardSettings;
  children?: ReactNode;
}): ReactElement;

/** The board: its views, rails, Ask and peeks. */
export declare function Whiteboard(): ReactElement;

/** The board's top bar. A host without chrome leaves it out. */
export declare function ReviewTopBar(): ReactElement;
