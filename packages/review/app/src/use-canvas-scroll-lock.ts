import { useEffect } from "react";

import { useReviewRoots } from "./review-root-context";

const locks = new WeakMap<HTMLElement, { count: number; overflow: string }>();

export function useCanvasScrollLock(active: boolean): void {
  const scrollRegionRef = useReviewRoots()?.scrollRegionRef;

  useEffect(() => {
    const scroller = scrollRegionRef?.current;

    if (!active || !scroller) return;

    let lock = locks.get(scroller);

    if (!lock) {
      lock = { count: 0, overflow: scroller.style.overflow };
      locks.set(scroller, lock);
      scroller.style.overflow = "hidden";
    }

    lock.count += 1;

    return () => {
      lock.count -= 1;

      if (lock.count === 0) {
        scroller.style.overflow = lock.overflow;
        locks.delete(scroller);
      }
    };
  }, [active, scrollRegionRef]);
}
