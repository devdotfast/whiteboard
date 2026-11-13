import { type RefObject, useCallback, useEffect, useState } from "react";

/** Whether `target` fills the screen, and a toggle for it. The browser
 * leaves fullscreen on Escape by itself. */
export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () =>
      setFull(
        document.fullscreenElement !== null &&
          document.fullscreenElement === target.current,
      );

    document.addEventListener("fullscreenchange", sync);

    return () => document.removeEventListener("fullscreenchange", sync);
  }, [target]);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.current?.requestFullscreen();
  }, [target]);

  return { full, toggle };
}

/** The scale that fits a `width` × `height` stage inside `area` while
 * `enabled`, growing it on big screens; 1 otherwise. */
export function useFit(
  area: RefObject<HTMLElement | null>,
  width: number,
  height: number,
  enabled: boolean,
) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = area.current;

    if (!enabled || !element) {
      setScale(1);

      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setScale(Math.min(box.width / width, box.height / height));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [area, width, height, enabled]);

  return scale;
}

export function FullscreenIcon({ full }: { full: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d={
          full
            ? "M5 1.5V5H1.5M9 1.5V5h3.5M5 12.5V9H1.5M9 12.5V9h3.5"
            : "M1.5 5V1.5H5M12.5 5V1.5H9M1.5 9v3.5H5M12.5 9v3.5H9"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
