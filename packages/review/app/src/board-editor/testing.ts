// Drives a board editor state the way keys and typing would, without a DOM.
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import type { BlockJSON, Board } from "./board-doc";
import { docToBoard } from "./board-doc";
import { createBoardState } from "./editor-state";

const mac = /Mac/.test(globalThis.navigator?.platform ?? "");

export class TestEditor {
  state: EditorState;

  constructor(
    public base: Board,
    state?: EditorState,
  ) {
    this.state = state ?? createBoardState(base);
  }

  dispatch = (tr: Transaction) => {
    this.state = this.state.apply(tr);
  };

  /** Enough of an EditorView for plugins' key and text handlers. */
  get view(): EditorView {
    // SAFETY: the handlers under test read only state, dispatch and composing.
    return {
      state: this.state,
      dispatch: this.dispatch,
      composing: false,
      focus: () => {},
    } satisfies Partial<EditorView> as EditorView;
  }

  /** The caret just after the first `text` in the document, or `offset`
   * characters into it. */
  caret(text: string, offset = text.length) {
    const at = this.find(text) + offset;
    this.dispatch(
      this.state.tr.setSelection(TextSelection.create(this.state.doc, at)),
    );

    return this;
  }

  find(text: string): number {
    let found = -1;
    this.state.doc.descendants((node, pos) => {
      if (found >= 0) return false;

      if (node.isText) {
        const index = node.text!.indexOf(text);

        if (index >= 0) found = pos + index;
      }

      return true;
    });

    if (found < 0) throw new Error(`No text ${JSON.stringify(text)}.`);

    return found;
  }

  type(text: string) {
    for (const char of text) {
      // A browser sends the key down before the text goes in.
      if (this.keyDown(char)) continue;
      const { from, to } = this.state.selection;

      const handled = this.state.plugins.some((plugin) =>
        plugin.props.handleTextInput?.call(
          plugin,
          this.view,
          from,
          to,
          char,
          () => this.state.tr.insertText(char, from, to),
        ),
      );

      if (!handled) this.dispatch(this.state.tr.insertText(char, from, to));
    }

    return this;
  }

  /** A key, "Enter", "Backspace", or with "Mod-" for ⌘ (Ctrl off a Mac). */
  press(...keys: string[]) {
    for (const name of keys) {
      const parts = name.split("-");
      const key = parts.pop()!;
      const mods = new Set(parts);

      this.keyDown(key, mods);
    }

    return this;
  }

  private keyDown(key: string, mods = new Set<string>()) {
    // SAFETY: the key handlers under test read only these fields.
    const event = {
      key,
      metaKey: mods.has("Mod") && mac,
      ctrlKey: mods.has("Mod") && !mac,
      shiftKey: mods.has("Shift"),
      altKey: false,
      preventDefault() {},
      stopPropagation() {},
    } as KeyboardEvent;

    return this.state.plugins.some((plugin) =>
      plugin.props.handleKeyDown?.call(plugin, this.view, event),
    );
  }

  /** The saved board's sections, by title, around the types of the rest. */
  get outline(): Outline[] {
    return outline(this.board.document);
  }

  /** The board this document saves as. */
  get board() {
    return docToBoard(this.state.doc, this.base);
  }

  /** Each top-level line of the body, as text, with a mark for its kind. */
  get lines(): string[] {
    const lines: string[] = [];
    this.state.doc.forEach((node, _pos, index) => {
      if (index === 0) return;

      if (node.type.name === "section")
        lines.push(`${"#".repeat(node.attrs.level)} ${node.textContent}`);
      else if (node.type.name === "atom")
        lines.push(`[${node.attrs.json.type}]`);
      else node.forEach((child) => lines.push(lineText(child)));
    });

    return lines;
  }

  get selectedBlock(): BlockJSON | undefined {
    const { selection } = this.state;

    return selection instanceof NodeSelection
      ? selection.node.attrs.json
      : undefined;
  }
}

function lineText(node: PMNode): string {
  switch (node.type.name) {
    case "bullet_list":
      return node.content.content
        .map((item) => `- ${item.textContent}`)
        .join("\n");
    case "task_list":
      return node.content.content
        .map(
          (item) => `- [${item.attrs.checked ? "x" : " "}] ${item.textContent}`,
        )
        .join("\n");
    case "table":
      return node.content.content
        .map(
          (row) =>
            `| ${row.content.content.map((cell) => cell.textContent).join(" | ")} |`,
        )
        .join("\n");
    case "ordered_list":
      return node.content.content
        .map((item, i) => `${i + node.attrs.start}. ${item.textContent}`)
        .join("\n");
    case "blockquote":
      return `> ${node.textContent}`;
    case "code_block":
      return `\`\`\`${node.textContent}\`\`\``;
    case "heading":
      return `${"#".repeat(node.attrs.depth)} ${node.textContent}`;
    default:
      return node.textContent;
  }
}

type Outline = string | { [title: string]: Outline[] };

const outline = (blocks: BlockJSON[]): Outline[] =>
  blocks.map((block) =>
    block.type === "section" && Array.isArray(block.children)
      ? { [String(block.title)]: outline(block.children) }
      : block.type,
  );
