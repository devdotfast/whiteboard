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
