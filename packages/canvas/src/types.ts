import type {
  CreateSourceViewer,
  WhiteboardComponent,
} from "@canvas/web-entry-api";

// The declarations index.ts publishes, without the canvas behind them: its
// exports are typed by these same aliases.

export type {
  SharedBoardBundle,
  WhiteboardProps,
  SourceRequest,
  SourceViewerOptions,
} from "@canvas/web-entry-api";

export declare const Whiteboard: WhiteboardComponent;

export declare const createSourceViewer: CreateSourceViewer;
