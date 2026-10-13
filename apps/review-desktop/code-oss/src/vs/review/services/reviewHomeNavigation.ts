import type { IEditorOptions } from "../../platform/editor/common/editor.js";
import { EditorPaneSelectionCompareResult, type IEditorPaneSelection } from "../../workbench/common/editor.js";

interface HomeNavigationOptions extends IEditorOptions {
  reviewHomeView?: "active" | "trash";
}

export function homeViewFromOptions(options: IEditorOptions | undefined): "active" | "trash" | undefined {
  return (options as HomeNavigationOptions | undefined)?.reviewHomeView;
}

export class ReviewHomeSelection implements IEditorPaneSelection {
  constructor(readonly view: "active" | "trash") {}

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
