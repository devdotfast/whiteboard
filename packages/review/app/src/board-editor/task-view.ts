import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";

/**
 * A task: its checkbox in place of the bullet, beside the item's first
 * line, as the read-only page draws one. Ticking it saves `- [x]`; the box
 * is no text, so the caret and typing never land in it.
 */
export class TaskItemView implements NodeView {
  dom: HTMLLIElement;
  contentDOM: HTMLDivElement;
  private box: HTMLInputElement;

  constructor(
    private node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("li");
    this.box = document.createElement("input");
    this.contentDOM = document.createElement("div");

    const label = document.createElement("label");

    label.contentEditable = "false";
    this.box.type = "checkbox";
    this.box.setAttribute("aria-label", "Done");
    label.append(this.box);
    this.dom.append(label, this.contentDOM);

    // A click on the box would put the caret beside it; it only ticks.
    this.box.addEventListener("mousedown", (event) => event.preventDefault());
    this.box.addEventListener("change", () => {
      const pos = getPos();

      if (pos === undefined || !view.editable) {
        this.box.checked = this.node.attrs.checked;

        return;
      }

      view.dispatch(
        view.state.tr.setNodeAttribute(pos, "checked", this.box.checked),
      );
    });
    this.draw(node);
  }

  private draw(node: PMNode) {
    // SAFETY: task_item's toDOM is a plain [tag, attrs, 0] spec.
    const [, attrs] = node.type.spec.toDOM!(node) as [
      string,
      Record<string, string>,
    ];

    for (const [name, value] of Object.entries(attrs))
      this.dom.setAttribute(name, value);
    this.box.checked = node.attrs.checked;
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.draw(node);

    return true;
  }

  stopEvent(event: Event) {
    return event.target === this.box;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return (
      mutation.type !== "selection" &&
      !this.contentDOM.contains(mutation.target)
    );
  }
}
