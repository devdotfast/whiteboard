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
import { onPlainClick, underRange } from "./passage-clicks";

export interface SelectedPassage {
  anchor: AskAnchor;
  quote: string;
}

export interface PassageMark {
  id: string;
  anchor: AskAnchor;
  /** Washed more deeply. */
  active?: boolean;
}

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

/** What a click in the article does itself: links and controls. */
const CLICKABLE = "a, button, input, textarea, select, [role=button]";

/** A mark's range follows its words, so it is found once per version drawn. */
export function HostPassageMarks({
  articleRef,
  revision,
}: {
  articleRef: RefObject<HTMLElement | null>;
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

    return onPlainClick(article, CLICKABLE, (event) => {
      const hit = [...found].flatMap(([id, range]) =>
        underRange(range, event.clientX, event.clientY) ? [id] : [],
      );

      if (hit.length) clicked(hit);
    });
  }, [article, host, found]);

  return null;
}
