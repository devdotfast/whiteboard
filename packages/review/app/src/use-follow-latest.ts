import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Still at the newest, though a pixel or two short of the very end. A wheel
 * notch up is more than this. */
const AT_LATEST_PX = 24;

/**
 * Follows a thread as it grows while the reader is at its newest, and leaves
 * it where they scrolled to once they scroll up, as Claude and Codex do.
 * `jump` returns them to the newest and follows again.
 */
export function useFollowLatest(
  scroller: RefObject<HTMLDivElement | null>,
  /** What the scroller shows. Following measures the scroller, which lays
   * out the whole window, so it waits for these to change rather than
   * running on every render, such as each keystroke of a question. */
  content: readonly unknown[],
) {
  const following = useRef(true);
  // A smooth jump passes through scroll positions short of the end; they are
  // the jump's, not the reader's.
  // Holds the end the jump is headed for, or false.
  const jumping = useRef<number | false>(false);
  const [atLatest, setAtLatest] = useState(true);

  const onScroll = useCallback(() => {
    const element = scroller.current;

    if (!element) return;

    const at =
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      AT_LATEST_PX;

    if (jumping.current && !at) return;
    jumping.current = false;
    following.current = at;
    setAtLatest(at);
  }, [scroller]);

  // A jump the reader cut short by scrolling leaves them where they stopped.
  const onScrollEnd = useCallback(() => {
    jumping.current = false;
    onScroll();
  }, [onScroll]);

  // After what it shows changes: answer text, a tool's row, the working
  // line. A smooth jump under way retargets to the new end, so what arrives
  // during it does not leave it short.
  useLayoutEffect(() => {
    const element = scroller.current;

    if (!element || !following.current) return;

    if (!jumping.current) element.scrollTop = element.scrollHeight;
    else if (jumping.current !== element.scrollHeight) {
      jumping.current = element.scrollHeight;
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
  }, content);

  /** Back to the newest, following again: smoothly from the arrow, at once
   * when the reader asks something and the question is what comes next. */
  const jump = useCallback(
    (behavior: "smooth" | "instant" = "smooth") => {
      const element = scroller.current;

      following.current = true;
      setAtLatest(true);

      if (!element) return;

      if (behavior === "instant") {
        jumping.current = false;
        element.scrollTop = element.scrollHeight;

        return;
      }

      jumping.current = element.scrollHeight;
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    },
    [scroller],
  );

  return { atLatest, onScroll, onScrollEnd, jump };
}
