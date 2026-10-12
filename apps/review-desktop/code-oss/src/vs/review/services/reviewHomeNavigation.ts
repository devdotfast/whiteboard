import type { IEditorOptions } from "../../platform/editor/common/editor.js";
import { EditorPaneSelectionCompareResult, type IEditorPaneSelection } from "../../workbench/common/editor.js";

interface HomeNavigationOptions extends IEditorOptions {
  reviewHomeView?: "live" | "deleted";
}

export function homeViewFromOptions(options: IEditorOptions | undefined): "live" | "deleted" | undefined {
  return (options as HomeNavigationOptions | undefined)?.reviewHomeView;
}

export class ReviewHomeSelection implements IEditorPaneSelection {
  constructor(readonly view: "live" | "deleted") {}

  compare(other: IEditorPaneSelection): EditorPaneSelectionCompareResult {
    return other instanceof ReviewHomeSelection && other.view === this.view
      ? EditorPaneSelectionCompareResult.IDENTICAL
      : EditorPaneSelectionCompareResult.DIFFERENT;
  }

  restore(options: IEditorOptions): IEditorOptions {
    return { ...options, reviewHomeView: this.view } as HomeNavigationOptions;
  }

  log(): string { return `home:${this.view}`; }
}
