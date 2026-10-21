import type {
  ReviewInlineEditorFactory,
  ReviewInlineFindSpec,
  ReviewTheme,
} from "@dev.fast/review-protocol";
import type { ShareManifest } from "@dev.fast/review-share-protocol";
import type { ReactElement } from "react";

// The web entry's public API as types only: @dev.fast/canvas publishes its
// declarations from here, without the canvas behind it.

/** A `review-share/1` bundle: its manifest and the objects it names. */
export interface SharedBoardBundle {
  manifest: ShareManifest;
  objects: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

export interface WhiteboardProps {
  share: SharedBoardBundle;
  /** Where the page serves libavoid.wasm, for software maps. */
  wasmUrl: string;
  theme?: ReviewTheme;
  /** Code peeks' editor. Without one they show as unavailable. */
  inlineEditors?: ReviewInlineEditorFactory;
}

/** The file a quote reads, at the side and pins it names. */
export type SourceRequest = ReviewInlineFindSpec;

export interface SourceViewerOptions {
  /** The whole file's text; lines outside the ranges are never shown. */
  readSource(request: SourceRequest): Promise<string>;
}

/** A shared board's content, read-only: its document and nothing around it. */
export type WhiteboardComponent = (props: WhiteboardProps) => ReactElement;

/** A read-only inline editor for hosts without Monaco. */
export type CreateSourceViewer = (
  options: SourceViewerOptions,
) => ReviewInlineEditorFactory;
