import type { ReviewDisposable } from "@dev.fast/review-protocol";
import {
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { type AskAnchor, resolveAskAnchor } from "./ask-anchor";
import { setCssHighlight } from "./css-highlights";

/** Selected document text, with where it is in its block. */
export interface SelectedPassage {
  anchor: AskAnchor;
  quote: string;
}

/** A passage the host keeps something about, such as a comment thread. */
export interface PassageMark {
  id: string;
  anchor: AskAnchor;
  /** Washed more deeply: the one the host's own UI points at. */
  active?: boolean;
}

/** What a host adds to selected text and marks in the document. */
export interface PassageHost {
  /** Buttons on the toolbar over selected document text. */
  actions?: readonly {
    label: string;
    onSelect(passage: SelectedPassage): void;
  }[];
  /** Leaves Copy ref off that toolbar. */
  hideCopyRef?: boolean;
  marks(): readonly PassageMark[];
  onDidChangeMarks(listener: () => void): ReviewDisposable;
  /** A plain click on marked words, with every mark under it. */
  onDidClickMarks?(ids: string[]): void;
  /** The marks whose words are gone from the document as drawn. */
  onDidResolveMarks?(lost: string[]): void;
}

const PassagesContext = createContext<{
  host: PassageHost;
  version: number;
} | null>(null);

/** `version` is the board drawn: a live board redraws under one revision. */
export function HostPassagesProvider({
  host,
  version,
  children,
}: {
  host: PassageHost | undefined;
  version: number;
  children: ReactNode;
}) {
  const value = useMemo(
    () => (host ? { host, version } : null),
    [host, version],
  );

  return <PassagesContext value={value}>{children}</PassagesContext>;
}

export const useHostPassages = () => useContext(PassagesContext)?.host ?? null;

const NO_MARKS: readonly PassageMark[] = [];

const noMarks = () => NO_MARKS;

const never = () => () => {};

/** How far a press may travel and still be a click. */
const CLICK_SLOP = 4;

const under = (range: Range, x: number, y: number) =>
  [...range.getClientRects()].some(
    (rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );

/**
 * Washes the host's marks over the document and tells it of clicks on them.
 * A mark's range follows its words, so it is found once per document drawn.
 */
export function HostPassageMarks({
  articleRef,
  revision,
}: {
  articleRef: RefObject<HTMLElement | null>;
  /** The rendered document; a new one is searched again. */
  revision: string;
}): null {
  const host = useHostPassages();
  const version = useContext(PassagesContext)?.version;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!host) return never();
      const subscription = host.onDidChangeMarks(listener);

      return () => subscription.dispose();
    },
    [host],
  );

  const marks = useSyncExternalStore(
    subscribe,
    () => host?.marks() ?? NO_MARKS,
    noMarks,
  );

  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [found, setFound] = useState<ReadonlyMap<string, Range>>(new Map());

  useEffect(() => setArticle(articleRef.current), [articleRef, revision]);

  useEffect(() => {
    if (!article || !host) return;

    const frame = requestAnimationFrame(() => {
      const ranges = new Map<string, Range>();
      const lost: string[] = [];

      for (const mark of marks) {
        const at = resolveAskAnchor(article, mark.anchor);

        if (at) ranges.set(mark.id, at.range);
        else lost.push(mark.id);
      }

      const washed = (active: boolean) =>
        marks.flatMap((mark) =>
          Boolean(mark.active) === active ? (ranges.get(mark.id) ?? []) : [],
        );

      setCssHighlight(article, "host-passage", washed(false));
      setCssHighlight(article, "host-passage-active", washed(true), 1);
      setFound(ranges);
      host.onDidResolveMarks?.(lost);
    });

    return () => {
      cancelAnimationFrame(frame);
      setCssHighlight(article, "host-passage", []);
      setCssHighlight(article, "host-passage-active", []);
    };
  }, [article, host, marks, revision, version]);

  // Only a plain click: a drag, a selection or a modifier is the reader's own.
  useEffect(() => {
    const clicked = host?.onDidClickMarks;

    if (!article || !clicked || !found.size) return;
    let pressed: { x: number; y: number } | null = null;

    const press = (event: PointerEvent) => {
      pressed =
        event.isPrimary && event.button === 0
          ? { x: event.clientX, y: event.clientY }
          : null;
    };

    const click = (event: MouseEvent) => {
      const from = pressed;

      pressed = null;

      if (
        !from ||
        event.detail !== 1 ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        Math.hypot(event.clientX - from.x, event.clientY - from.y) >
          CLICK_SLOP ||
        article.ownerDocument.getSelection()?.isCollapsed === false
      )
        return;

      const hit = [...found].flatMap(([id, range]) =>
        under(range, event.clientX, event.clientY) ? [id] : [],
      );

      if (hit.length) clicked(hit);
    };

    article.addEventListener("pointerdown", press);
    article.addEventListener("click", click);

    return () => {
      article.removeEventListener("pointerdown", press);
      article.removeEventListener("click", click);
    };
  }, [article, host, found]);

  return null;
}
