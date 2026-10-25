import {
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

export interface ReviewRoots {
  appRef: RefObject<HTMLDivElement | null>;
  shellRef: RefObject<HTMLElement | null>;
  scrollRegionRef: RefObject<HTMLElement | null>;
  articleRef: RefObject<HTMLElement | null>;
}

const ReviewRootsContext = createContext<ReviewRoots | null>(null);

const ReviewContainerContext = createContext<HTMLElement | null>(null);

export function ReviewRootsProvider({
  roots,
  children,
}: {
  roots: ReviewRoots;
  children: ReactNode;
}) {
  return (
    <ReviewRootsContext.Provider value={roots}>
      {children}
    </ReviewRootsContext.Provider>
  );
}

export function useReviewRoots(): ReviewRoots | null {
  return useContext(ReviewRootsContext);
}

export function ReviewContainerProvider({
  container,
  children,
}: {
  container: HTMLElement;
  children: ReactNode;
}) {
  return (
    <ReviewContainerContext.Provider value={container}>
      {children}
    </ReviewContainerContext.Provider>
  );
}

export function useReviewContainer(): HTMLElement | null {
  return useContext(ReviewContainerContext);
}

/** A host that names no container gets the `.review-canvas-root` around the
 * board, found once it mounts; overlays portal there. */
export function CanvasRootContainer({ children }: { children: ReactNode }) {
  const outer = useContext(ReviewContainerContext);
  const roots = useContext(ReviewRootsContext);
  const [own, setOwn] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!outer)
      setOwn(
        roots?.appRef.current?.closest<HTMLElement>(".review-canvas-root") ??
          null,
      );
  }, [outer, roots]);

  return (
    <ReviewContainerContext.Provider value={outer ?? own}>
      {children}
    </ReviewContainerContext.Provider>
  );
}
