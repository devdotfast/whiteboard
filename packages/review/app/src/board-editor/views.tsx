import { MarkdownContent } from "@canvas/agent-markdown";
import type { ApiDocumentData } from "@canvas/api-document";
import type { StoredBlock } from "@canvas/blocks";
import { MarkdownMath } from "@canvas/markdown-math";
import {
  ReviewDocumentTitleSlot,
  documentTitleClassName,
} from "@canvas/review-document-surface";
import { fontSize } from "@canvas/scale.stylex";
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

  constructor(
    node: PMNode,
    store: PortalStore,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    super(node, store, "div");
    this.dom.className = "review-board-atom";
    // A click anywhere on the block selects it, once what was clicked has
    // handled it: an editor inside, which keeps its mousedown to itself,
    // takes the focus (and the scroll) on the same click, and selecting
    // after it leaves that focus where it is.
    this.dom.addEventListener(
      "mousedown",
      () =>
        setTimeout(() => {
          const pos = this.getPos();

          if (pos === undefined || this.selected) return;
          this.view.dispatch(
            this.view.state.tr.setSelection(
              NodeSelection.create(this.view.state.doc, pos),
            ),
          );
        }),
      true,
    );
    this.show();
  }

  protected render() {
    return <RichBlock block={this.node.attrs.json} selected={this.selected} />;
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

export function nodeViews(store: PortalStore) {
  return {
    title: (node) => new TitleView(node, store),
    atom: (node, view, getPos) => new RichBlockView(node, store, view, getPos),
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
    font: `${fontSize.small}/14px ${tokens.chromeFont}`,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  // The hint's own size; the keys keep the kit's spacing.
  hintKey: { fontSize: "inherit", lineHeight: "inherit" },
});
