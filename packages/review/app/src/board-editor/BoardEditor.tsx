import { useAgentSelection } from "@canvas/agent-selection";
import type { ApiDocumentData } from "@canvas/api-document";
import { DocumentNode, useEditingBlock } from "@canvas/api-document";
import { Courier } from "@canvas/courier";
import type { MotionPhase } from "@canvas/draw-queue";
import { useMotionPhases } from "@canvas/draw-queue-provider";
import { drawStyles } from "@canvas/draw-styles";
import { useReviewSession } from "@canvas/host/review-session";
import {
  BoardSaveRetryContext,
  type BoardSaveStatus,
  BoardSaveStatusContext,
} from "@canvas/review-doc-meta";
import type { ReviewTocEntry } from "@canvas/review-document-headings";
import {
  scrollToReviewBlock,
  scrollToReviewHeading,
} from "@canvas/review-heading-scroll";
import { useReviewPanel } from "@canvas/review-panel";
import { useReviewRoots } from "@canvas/review-root-context";
import {
  readReviewUiState,
  reviewUiStateKey,
  writeReviewUiState,
} from "@canvas/review-ui-state";
import type { ReviewApiClient } from "@review/review-api/client";
import { boardLink, traceQuoteLink } from "@review/review-api/document";
import * as stylex from "@stylexjs/stylex";
import type { Mark, ResolvedPos } from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import {
  type ReactElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { blockIndex, isNewBoard, storedBlocks } from "./board-doc";
import { createBoardState } from "./editor-state";
import { headings, headingsKey, revealLine, textOnly } from "./headings";
import { httpBoardTransport } from "./http-transport";
import { captureRemoved, motion, motionKey } from "./motion";
import { type OpenLink, openLinkKey, openLinks } from "./open-links";
import { type SlashState, slashKey } from "./slash";
import { SlashMenu } from "./SlashMenu";
import { REMOTE } from "./structure";
import { type BoardSync, openBoardSync } from "./sync";
import { PortalStore, Portals, RichBlockContext, nodeViews } from "./views";

// A board on the canvas, editable in place: the editor document, its
// autosave, the block the person is in, and what other authors write.

/** What the canvas gives its board editor. */
export interface BoardEditorHost {
  client: ReviewApiClient;
  /** The editor's Contents, as the person types. */
  setHeadings(entries: ReviewTocEntry[] | undefined): void;
}

export const BoardEditorHostContext = createContext<BoardEditorHost | null>(
  null,
);

/** The text of the link at `$pos`, across the marks inside it. */
function linkText($pos: ResolvedPos, link: Mark): string {
  const parent = $pos.parent;
  const index = $pos.index();
  let from = index;
  let to = index;

  while (from > 0 && link.isInSet(parent.child(from - 1).marks)) from--;

  while (to < parent.childCount && link.isInSet(parent.child(to).marks)) to++;
  let text = "";

  for (let i = from; i < to; i++) text += parent.child(i).textContent;

  return text;
}

/** The document data, kept the same while what rich blocks read from it
 * stays the same: resources, links and the board's source. */
function useStableData(data: ApiDocumentData): ApiDocumentData {
  const kept = useRef(data);
  const { snapshot } = data;

  const key = JSON.stringify([
    snapshot.reviewId,
    snapshot.pins,
    snapshot.target,
    snapshot.staleSources,
    snapshot.sourceUnavailable,
    [...data.anchors.keys()],
    [...data.images.keys()],
    [...data.traces.keys()],
    [...data.boards.keys()],
    [...data.maps.keys()],
    data.commits.length,
  ]);

  const keyRef = useRef(key);

  if (keyRef.current !== key) {
    keyRef.current = key;
    kept.current = data;
  }

  return kept.current;
}

export function BoardEditor({
  data,
  softwareMapEnabled,
}: {
  data: ApiDocumentData;
  softwareMapEnabled: boolean;
}): ReactElement {
  const host = useContext(BoardEditorHostContext)!;
  const roots = useReviewRoots();
  const session = useReviewSession();
  const selectForAgent = useAgentSelection();
  const agentSelection = useRef(selectForAgent);
  agentSelection.current = selectForAgent;
  const openPeek = useReviewPanel((state) => state.openPeek);
  const phases = useMotionPhases();

  const [status, setStatus] = useState<BoardSaveStatus | undefined>(() =>
    isNewBoard(data.snapshot) ? "new" : undefined,
  );

  const [slash, setSlash] = useState<{
    state: SlashState;
    view: EditorView;
  } | null>(null);

  const store = useMemo(() => new PortalStore(), []);
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const sync = useRef<BoardSync>(undefined);
  const latest = useRef(data);
  latest.current = data;
  const reviewId = data.snapshot.reviewId;

  useLayoutEffect(() => {
    const snapshot = latest.current.snapshot;
    const stored = blockIndex(storedBlocks(snapshot.document));

    let sourceSelectionRevision = 0;

    const stopSourceSelection = session.surface.subscribe((event) => {
      if (
        event.event === "editorSelectionChanged" &&
        event.reviewId === reviewId &&
        event.isEmpty === false
      )
        sourceSelectionRevision++;
    });

    const uiKey = (key: string) =>
      reviewUiStateKey(
        session.config,
        "session",
        "section",
        `${reviewId}:${key}`,
      );

    // Everything typed until it is saved: the hold, autosave, merging
    // other authors' versions, closing and the window's shutdown.
    const own = openBoardSync({
      board: {
        version: snapshot.version,
        title: snapshot.title,
        document: storedBlocks(snapshot.document),
      },
      transport: httpBoardTransport(host.client, reviewId),
      editor: {
        state: () => editor.state,
        dispatch: (tr) => editor.dispatch(tr),
      },
      // An untouched new board stays new: nothing was saved.
      onStatus: (next) =>
        setStatus((current) =>
          current === "new" && next === "saved" ? current : next,
        ),
    });

    sync.current = own;

    const state = createBoardState(own.initial, [
      headings({
        initiallyCollapsed: (key) =>
          readReviewUiState<boolean>("session", uiKey(key)) ??
          stored.get(key)?.defaultCollapsed === true,
        remember: (key, collapsed) =>
          writeReviewUiState("session", uiKey(key), collapsed),
      }),
      motion(),
      openLinks(() => latest.current),
    ]);

    // Contents changes only when a heading does, not at every keystroke.
    let published: ReviewTocEntry[] | undefined;

    const publish = (next: EditorState) => {
      const entries = headingsKey.getState(next)?.entries;

      if (entries !== published) {
        published = entries;
        host.setHeadings(entries);
      }

      const menu = slashKey.getState(next)!;
      setSlash(menu.open ? { state: menu, view: editor } : null);
    };

    // Blocks skip layout off screen only after they render once, so each
    // keeps its real size.
    let settling = 0;

    const remeasure = () => {
      cancelAnimationFrame(settling);
      editor.dom.removeAttribute("data-board-settled");
      settling = requestAnimationFrame(() => {
        settling = requestAnimationFrame(() =>
          editor.dom.setAttribute("data-board-settled", ""),
        );
      });
    };

    const editor: EditorView = new EditorView(
      { mount: mount.current! },
      {
        state,
        nodeViews: nodeViews(store, () => sourceSelectionRevision),
        attributes: { class: "review-board-editor", spellcheck: "true" },
        dispatchTransaction(tr: Transaction) {
          const before = editor.state;
          // Blocks another author removed are erased where they stood.
          const ghosts = captureRemoved(editor, tr);
          const next = before.apply(tr);
          editor.updateState(next);

          if (tr.selectionSet || tr.docChanged) {
            const selected = next.selection;

            if (
              selected instanceof NodeSelection &&
              selected.node.type.name === "atom"
            ) {
              const block = selected.node.attrs.json;
              const element = editor.nodeDOM(selected.from);

              if (element instanceof HTMLElement) {
                const rect = element.getBoundingClientRect();
                agentSelection.current({
                  target: { kind: "block", blockId: block.id },
                  title: (
                    block.title ||
                    block.caption ||
                    block.type.replaceAll("_", " ")
                  ).slice(0, 500),
                  apiSource: {
                    reviewId,
                    version: latest.current.snapshot.version,
                  },
                  anchorElement: element,
                  anchor: {
                    x: rect.left,
                    y: Math.max(
                      rect.top,
                      (editor.dom
                        .closest(".review-view-region")
                        ?.getBoundingClientRect().top ?? 0) + 36,
                    ),
                  },
                  onDismiss: () => {
                    if (editor.isDestroyed) return;
                    const current = editor.state.selection;

                    if (
                      current instanceof NodeSelection &&
                      current.node.attrs.json?.id === block.id
                    ) {
                      const caret =
                        Selection.findFrom(
                          editor.state.doc.resolve(current.to),
                          1,
                          true,
                        ) ??
                        Selection.findFrom(
                          editor.state.doc.resolve(current.from),
                          -1,
                          true,
                        );

                      if (caret)
                        editor.dispatch(editor.state.tr.setSelection(caret));
                    }
                  },
                });
              }
            } else if (
              before.selection instanceof NodeSelection &&
              before.selection.node.type.name === "atom"
            ) {
              agentSelection.current(null);
            }
          }

          own.tell({ tr });

          if (tr.docChanged)
            editor.dom
              .querySelector("h1[data-review-copy-ignore]")
              ?.removeAttribute("data-review-copy-ignore");

          publish(next);

          if (
            (tr.docChanged && !textOnly(tr)) ||
            headingsKey.getState(before)?.collapsed !==
              headingsKey.getState(next)?.collapsed
          )
            remeasure();

          if (ghosts.length)
            editor.dispatch(
              editor.state.tr
                .setMeta(motionKey, { ghosts })
                .setMeta(REMOTE, true),
            );
        },
        handleDOMEvents: {
          // A link follows on click and never takes the caret: its press
          // is kept from the editor and the browser.
          mousedown: (_current, event) => {
            if (
              event.button !== 0 ||
              !(event.target instanceof Element) ||
              !event.target.closest("a[data-href]")
            )
              return false;
            event.preventDefault();

            return true;
          },
          click: (current, event) => {
            if (event.button !== 0 || !follow(current, event)) return false;
            event.preventDefault();

            return true;
          },
          focus: () => {
            own.tell({ focused: true });

            return false;
          },
          blur: () => {
            own.tell({ focused: false });

            return false;
          },
        },
      },
    );

    const follow = (current: EditorView, event: MouseEvent): boolean => {
      const anchorElement =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("a[data-href]")
          : null;

      if (!anchorElement || !current.dom.contains(anchorElement)) return false;
      const pos = current.posAtDOM(anchorElement, 0);
      const $pos = current.state.doc.resolve(pos);

      const link = current.state.doc
        .nodeAt(pos)
        ?.marks.find((mark) => mark.type.name === "link");

      if (!link) return false;
      const href: string = link.attrs.href;
      const blockId = $pos.depth >= 1 ? $pos.node(1).attrs.id : null;
      const anchor = latest.current.anchors.get(`${blockId}:${href}`);

      if (anchor) {
        openPeek({
          kind: "peek",
          anchor,
          content: { kind: "source", source: anchor.peek },
        });

        return true;
      }

      const quote = traceQuoteLink(href);

      if (quote) {
        const events = latest.current.traces.get(quote.traceId)?.events;

        const event = events?.findIndex((item) => item.id === quote.eventId);

        openPeek({
          kind: "peek",
          content: {
            kind: "trace-quote",
            sessionId: quote.traceId,
            event: event === undefined || event < 0 ? undefined : event,
            quote: linkText($pos, link),
          },
        });

        return true;
      }

      // A heading on this board, by its anchor, or a block on this board:
      // scrolled to in place, as the read-only page does.
      const fragment = href.startsWith("#") ? href.slice(1) : undefined;
      const board = boardLink(href);

      if (fragment !== undefined || board?.board === reviewId) {
        const article = roots?.articleRef.current ?? current.dom;
        const region = roots?.scrollRegionRef.current ?? null;

        if (fragment) scrollToReviewHeading(fragment, article, region);
        else if (board?.block)
          scrollToReviewBlock(board.block, article, region);

        return true;
      }

      if (board) {
        void session.surface.post({
          name: "openReview",
          args: {
            reviewUuid: board.board,
            active: !(event.metaKey || event.ctrlKey || event.shiftKey),
            ...(board.block !== undefined && { blockId: board.block }),
          },
        });

        return true;
      }

      if (/^(https?|mailto):/.test(href))
        window.open(href, "_blank", "noopener,noreferrer");

      return true;
    };

    view.current = editor;

    // Contents and anchor links expand a collapsed heading before scrolling
    // to a line inside it.
    const reveal = (event: Event) => {
      if (event.target instanceof Node && editor.dom.contains(event.target))
        revealLine(editor, editor.posAtDOM(event.target, 0) - 1);
    };

    editor.dom.addEventListener("review-section-expand", reveal, true);
    publish(editor.state);

    // A new board opens with the caret in its empty title, so typing names
    // it. The title's header renders on React's next commit.
    const naming = isNewBoard(snapshot)
      ? requestAnimationFrame(() => {
          // Named, not asked about: no Ask toolbar until the person types.
          editor.dom
            .querySelector("h1")
            ?.setAttribute("data-review-copy-ignore", "");
          editor.focus();
          editor.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, 1),
            ),
          );
        })
      : undefined;

    // Shown again or resized, every block renders once at its new width.
    let width = 0;

    const laidOut = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;

      if (next && next !== width) remeasure();
      width = next;
    });

    laidOut.observe(editor.dom);

    return () => {
      stopSourceSelection();

      if (naming !== undefined) cancelAnimationFrame(naming);

      cancelAnimationFrame(settling);
      laidOut.disconnect();
      editor.dom.removeEventListener("review-section-expand", reveal, true);
      // Everything typed is saved before the board lets go of its hold, so
      // a discard on close can never beat the last save.
      void own.close();
      host.setHeadings(undefined);
      editor.destroy();
      view.current = undefined;
    };
  }, [reviewId]);

  // Every version from the stream: another author's, or our own coming back.
  useEffect(() => {
    const { version, title, document } = data.snapshot;

    sync.current?.tell({
      version: {
        version,
        title,
        document: storedBlocks(document),
        personEdit: data.snapshot.personEdit,
      },
    });
  }, [data.snapshot]);

  useEffect(() => {
    const editor = view.current;

    if (editor)
      editor.dispatch(
        editor.state.tr.setMeta(motionKey, { phases }).setMeta(REMOTE, true),
      );
  }, [phases]);

  // The ring around the block an agent is writing in.
  const region = useEditingBlock();

  const regionKey = region
    ? `${region.id}:${region.writing}:${region.slot}`
    : "";

  useEffect(() => {
    const editor = view.current;

    if (editor)
      editor.dispatch(
        editor.state.tr.setMeta(motionKey, { region }).setMeta(REMOTE, true),
      );
  }, [regionKey]);

  // The link whose target the side column shows keeps its wash.
  const openKey = useReviewPanel((state) => {
    const peek = state.active?.kind === "peek" ? state.active : null;

    const open: OpenLink = peek?.anchor
      ? { anchorId: peek.anchor.id }
      : peek?.content.kind === "trace-quote"
        ? { traceId: peek.content.sessionId, event: peek.content.event }
        : null;

    return JSON.stringify(open);
  });

  useEffect(() => {
    const editor = view.current;

    if (editor)
      editor.dispatch(
        editor.state.tr
          .setMeta(openLinkKey, JSON.parse(openKey))
          .setMeta(REMOTE, true),
      );
  }, [openKey]);

  const retry = useCallback(() => sync.current?.tell("retry"), []);

  // Rich blocks render again only when what they read changes: a new
  // version that only edits text leaves them alone.
  const richData = useStableData(data);

  const rich = useMemo(
    () => ({
      data: richData,
      render: (
        block: Parameters<typeof DocumentNode>[0]["node"],
        current: ApiDocumentData,
      ) => (
        <DocumentNode
          node={block}
          data={current}
          softwareMapEnabled={softwareMapEnabled}
          region={
            region
              ? region.id === block.id
                ? region.writing
                  ? "writing"
                  : "idle"
                : "off"
              : undefined
          }
          regionSlot={
            region && region.id === block.id ? region.slot : undefined
          }
        />
      ),
    }),
    [richData, softwareMapEnabled, regionKey],
  );

  return (
    <BoardSaveStatusContext.Provider value={status}>
      <BoardSaveRetryContext.Provider value={retry}>
        <RichBlockContext.Provider value={rich}>
          <div {...stylex.props(styles.editor)}>
            <div ref={mount} />
            {slash?.state.open && (
              <SlashMenu state={slash.state} view={slash.view} />
            )}
          </div>
          <Portals store={store} />
          <Courier />
        </RichBlockContext.Provider>
      </BoardSaveRetryContext.Provider>
    </BoardSaveStatusContext.Provider>
  );
}

const styles = stylex.create({
  editor: { position: "relative" },
});
