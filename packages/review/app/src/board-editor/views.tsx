import { MarkdownContent } from "@canvas/agent-markdown";
import type { ApiDocumentData } from "@canvas/api-document";
import type { StoredBlock } from "@canvas/blocks";
import { MarkdownMath } from "@canvas/markdown-math";
import {
  ReviewDocumentTitleSlot,
  documentTitleClassName,
} from "@canvas/review-document-surface";
import { fontSize, leading } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Shortcut } from "@canvas/ui/kbd";
import { UNTITLED_BOARD } from "@dev.fast/review-protocol";
import { parseMarkdown } from "@review/markdown";
import * as stylex from "@stylexjs/stylex";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from "@tiptap/pm/view";
import {
  type ReactNode,
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import type { BlockJSON } from "./board-doc";
import { TaskItemView } from "./task-view";

// The parts of a board ProseMirror doesn't draw itself: the title's header,
// rich blocks through their own components, and Markdown it keeps as
// source (tables, math). Each renders into its node's DOM through a React
// portal, so it sees the canvas's contexts.

/** What a rich block renders with: the board's loaded resources. */
export interface RichBlockRenderer {
  data: ApiDocumentData;
  render(block: StoredBlock, data: ApiDocumentData): ReactNode;
}

export const RichBlockContext = createContext<RichBlockRenderer | null>(null);

type Portal = { container: HTMLElement; element: ReactNode };

/** The portals node views ask for, rendered by <Portals>. */
export class PortalStore {
  private portals = new Map<string, Portal>();
  private listeners = new Set<() => void>();
  private snapshot: [string, Portal][] = [];
  private count = 0;

  key = () => `view-${this.count++}`;

  set(key: string, portal: Portal | undefined) {
    if (portal) this.portals.set(key, portal);
    else this.portals.delete(key);
    this.snapshot = [...this.portals];
    // A portal renders on React's next commit, never inside a transaction.
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  read = () => this.snapshot;
}

export function Portals({ store }: { store: PortalStore }) {
  const portals = useSyncExternalStore(store.subscribe, store.read);

  return portals.map(([key, portal]) => (
    <PortalSlot key={key} portal={portal} />
  ));
}

/** One portal, drawn again only when its node view shows something new. */
const PortalSlot = memo(function PortalSlot({ portal }: { portal: Portal }) {
  return createPortal(portal.element, portal.container);
});

/** A view whose whole DOM React draws: events and changes inside are its own. */
abstract class ReactView implements NodeView {
  dom: HTMLElement;
  protected key: string;

  constructor(
    protected node: PMNode,
    protected store: PortalStore,
    tag: "div" | "span",
  ) {
    this.dom = document.createElement(tag);
    this.dom.contentEditable = "false";
    this.key = store.key();
  }

  protected abstract render(): ReactNode;

  protected show() {
    this.store.set(this.key, { container: this.dom, element: this.render() });
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;

    if (node !== this.node) {
      this.node = node;
      this.show();
    }

    return true;
  }

  stopEvent() {
    return true;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.store.set(this.key, undefined);
  }
}

class RichBlockView extends ReactView {
  private selected = false;
  private gesture?: AbortController;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private pendingSelection?: AbortController;

  constructor(
    node: PMNode,
    store: PortalStore,
    private view: EditorView,
    private getPos: () => number | undefined,
    private sourceSelectionRevision: () => number,
  ) {
    super(node, store, "div");
    this.dom.className = "review-board-atom";
    // Select after the click completes. Selecting during mousedown lets
    // a later native selection drag restore the previous prose caret.
    // Inner editors keep their focus; drags do not select the outer block.

    let press:
      | {
          x: number;
          y: number;
          dragged: boolean;
          sourceSelectionRevision: number;
        }
      | undefined;

    this.dom.addEventListener(
      "mousedown",
      (event) => {
        this.cancelSelection();
        this.gesture?.abort();
        press = undefined;

        if (
          event.button !== 0 ||
          event.buttons !== 1 ||
          (event.target instanceof Element &&
            event.target.closest(
              '[role="button"][aria-expanded], button[aria-expanded]',
            ))
        )
          return;

        const start = {
          x: event.clientX,
          y: event.clientY,
          dragged: false,
          sourceSelectionRevision: this.sourceSelectionRevision(),
        };

        press = start;
        const tracking = new AbortController();
        this.gesture = tracking;
        const document = this.dom.ownerDocument;
        const options = { capture: true, signal: tracking.signal };
        document.addEventListener(
          "mousemove",
          (move) => {
            if (move.buttons !== 1) {
              press = undefined;
              tracking.abort();

              return;
            }

            // Match the 4px click tolerance used by Ask's passage marks.
            if (Math.hypot(move.clientX - start.x, move.clientY - start.y) > 4)
              start.dragged = true;
          },
          options,
        );
        document.addEventListener(
          "mouseup",
          (release) => {
            tracking.abort();

            if (
              release.button !== 0 ||
              release.buttons !== 0 ||
              !(release.target instanceof Node) ||
              !this.dom.contains(release.target)
            )
              press = undefined;
          },
          options,
        );
        document.addEventListener(
          "pointercancel",
          () => {
            press = undefined;
            this.cancelSelection();
            tracking.abort();
          },
          options,
        );
      },
      true,
    );
    this.dom.addEventListener(
      "click",
      (event) => {
        const start = press;
        press = undefined;
        this.gesture?.abort();

        if (
          event.button !== 0 ||
          event.detail === 0 ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !start ||
          start.dragged ||
          start.sourceSelectionRevision !== this.sourceSelectionRevision() ||
          (event.detail > 1 &&
            event.target instanceof Element &&
            event.target.closest(".monaco-editor"))
        )
          return;
        const pending = new AbortController();
        this.pendingSelection = pending;
        const cancel = () => this.cancelSelection();
        const options = { capture: true, signal: pending.signal };
        const document = this.dom.ownerDocument;
        document.addEventListener("mousedown", cancel, options);
        document.addEventListener("pointercancel", cancel, options);
        document.addEventListener("keydown", cancel, options);
        document.addEventListener("wheel", cancel, {
          ...options,
          passive: true,
        });
        document.defaultView?.addEventListener("blur", cancel, {
          signal: pending.signal,
        });
        this.selectionTimer = setTimeout(() => {
          this.cancelSelection();

          if (
            this.view.isDestroyed ||
            start.sourceSelectionRevision !== this.sourceSelectionRevision()
          )
            return;
          const selection = this.dom.ownerDocument.getSelection();

          if (
            selection &&
            !selection.isCollapsed &&
            this.dom.contains(selection.anchorNode) &&
            this.dom.contains(selection.focusNode)
          )
            return;
          const pos = this.getPos();

          if (pos === undefined || this.view.isDestroyed) return;
          this.view.dispatch(
            this.view.state.tr.setSelection(
              NodeSelection.create(this.view.state.doc, pos),
            ),
          );
        });
      },
      true,
    );
    this.show();
  }

  protected render() {
    return <RichBlock block={this.node.attrs.json} selected={this.selected} />;
  }

  private cancelSelection() {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = undefined;
    this.pendingSelection?.abort();
    this.pendingSelection = undefined;
  }

  destroy() {
    this.cancelSelection();
    this.gesture?.abort();
    super.destroy();
  }

  selectNode() {
    this.selected = true;
    this.show();
  }

  deselectNode() {
    this.selected = false;
    this.show();
  }
}

/** A rich block, and while it is selected an outline and how to delete it. */
function RichBlock({
  block,
  selected,
}: {
  block: BlockJSON;
  selected: boolean;
}) {
  const renderer = useContext(RichBlockContext);
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<{ top: number; right: number }>();

  // The hint sits under the block's own card, which may be narrower than
  // the page.
  useLayoutEffect(() => {
    const card = ref.current?.querySelector(
      ":scope > [data-review-node-id] > *",
    );

    if (!selected || !card || !ref.current) {
      setHint(undefined);

      return;
    }

    const box = ref.current.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    setHint({ top: rect.bottom - box.top + 7, right: box.right - rect.right });
  }, [selected]);

  if (!renderer) return null;

  // SAFETY: a stored rich block always carries its server id.
  const stored = block as StoredBlock;

  return (
    <div
      ref={ref}
      {...stylex.props(styles.rich)}
      data-board-selected={selected || undefined}
    >
      {renderer.render(stored, renderer.data)}
      {selected && hint && (
        <span
          {...stylex.props(styles.hint)}
          style={{ top: hint.top, right: hint.right }}
        >
          <Shortcut xstyle={styles.hintKey}>⌫</Shortcut> to delete ·{" "}
          <Shortcut xstyle={styles.hintKey}>⌘Z</Shortcut> restores
        </span>
      )}
    </div>
  );
}

/** Markdown kept as its source: rendered as the document always has. */
class RawBlockView extends ReactView {
  constructor(node: PMNode, store: PortalStore) {
    super(node, store, "div");
    this.show();
  }

  protected render() {
    return <MarkdownContent source={this.node.attrs.source} />;
  }
}

class RawInlineView extends ReactView {
  constructor(node: PMNode, store: PortalStore) {
    super(node, store, "span");
    this.show();
  }

  protected render() {
    const source: string = this.node.attrs.source;

    if (this.node.attrs.kind === "inlineMath") {
      const math = parseMarkdown(source).children?.[0]?.children?.[0];

      if (math?.type === "inlineMath")
        return <MarkdownMath tex={math.value ?? ""} display={false} />;
    }

    return source;
  }
}

/** The board's title, edited in place inside its header. */
class TitleView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private key: string;

  constructor(
    node: PMNode,
    private store: PortalStore,
  ) {
    this.dom = document.createElement("div");
    this.contentDOM = document.createElement("h1");
    this.contentDOM.className = documentTitleClassName;
    this.contentDOM.dataset.reviewCopyProse = "";
    this.unnamed(node);
    this.key = store.key();
    store.set(this.key, {
      container: this.dom,
      element: <ReviewDocumentTitleSlot title={this.contentDOM} />,
    });
  }

  update(node: PMNode) {
    if (node.type.name !== "title") return false;
    this.unnamed(node);

    return true;
  }

  /** A board not yet named: "Untitled", faint, in the heading's own type,
   * until a title is typed. */
  private unnamed(node: PMNode) {
    const empty = !node.content.size;

    this.contentDOM.classList.toggle("review-board-placeholder", empty);

    if (empty) this.contentDOM.dataset.placeholder = UNTITLED_BOARD;
    else delete this.contentDOM.dataset.placeholder;
  }

  stopEvent(event: Event) {
    // SAFETY: events reaching a node view come from DOM nodes inside it.
    return !this.contentDOM.contains(event.target as Node);
  }

  ignoreMutation(
    mutation: MutationRecord | { type: "selection"; target: Node },
  ) {
    // The h1's own attributes are the page's (Copy ref marks it), not
    // the title's text.
    if (mutation.type === "attributes") return true;

    return (
      mutation.type !== "selection" &&
      !this.contentDOM.contains(mutation.target)
    );
  }

  destroy() {
    this.store.set(this.key, undefined);
  }
}

export function nodeViews(
  store: PortalStore,
  sourceSelectionRevision: () => number = () => 0,
) {
  return {
    title: (node) => new TitleView(node, store),
    atom: (node, view, getPos) =>
      new RichBlockView(node, store, view, getPos, sourceSelectionRevision),
    md_raw: (node) => new RawBlockView(node, store),
    inline_raw: (node) => new RawInlineView(node, store),
    task_item: (node, view, getPos) => new TaskItemView(node, view, getPos),
  } satisfies Record<string, NodeViewConstructor>;
}

const styles = stylex.create({
  rich: {
    position: "relative",
  },
  hint: {
    position: "absolute",
    color: tokens.inkFaint,
    font: `${fontSize.small}/${leading.px14} ${tokens.chromeFont}`,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  // The hint's own size; the keys keep the kit's spacing.
  hintKey: { fontSize: "inherit", lineHeight: "inherit" },
});
