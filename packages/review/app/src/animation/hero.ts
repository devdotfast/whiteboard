import {
  type RefObject,
  createContext,
  useLayoutEffect,
  useState,
} from "react";

// A board that opens on an animation shows it as its hero: big, edge to
// edge across the reader's pane, as tall as its drawing, with its caption
// right under it. It plays once and holds its last frame.

/** The id of the animation a board shows as its hero, if any. */
export const HeroContext = createContext<string | null>(null);

export interface HeroBox {
  /** From the figure's own left edge to the pane's. */
  left: number;
  width: number;
  /** The pane's visible height under where the hero starts, as the board
   * opens: what the hero and its caption share on the first screen. */
  room: number;
}

/** Where a hero figure goes: the pane's full width. Measured again as the
 * pane resizes. */
export function useHeroBox(
  figure: RefObject<HTMLElement | null>,
  on: boolean,
): HeroBox | null {
  const [box, setBox] = useState<HeroBox | null>(null);

  useLayoutEffect(() => {
    const element = figure.current;
    const parent = element?.parentElement;
    const pane = element?.closest<HTMLElement>(".review-view-region");

    if (!on || !element || !parent || !pane) {
      setBox(null);

      return;
    }

    const measure = () => {
      const frame = pane.getBoundingClientRect();
      const column = parent.getBoundingClientRect();
      const top = column.top - frame.top + pane.scrollTop;

      setBox({
        left: frame.left + pane.clientLeft - column.left,
        width: pane.clientWidth,
        room: pane.clientHeight - top,
      });
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(pane);
    observer.observe(parent);

    return () => observer.disconnect();
  }, [figure, on]);

  return box;
}

/** The most a hero scales its drawing up, and down: a tall drawing shrinks
 * a little to keep its caption in view, never past legible. */
const MAX_ZOOM = 2;

const MIN_ZOOM = 0.75;

/** Room the hero leaves for its caption under it. */
const BELOW = 120;

/** The least height a hero is fitted to, however little room is left. */
const MIN_ROOM = 280;

/** Share of the pane's width the drawing may take. */
const WIDTH_SHARE = 0.86;

/** How a hero shows its stage: scaled so the drawing reads big, as wide as
 * the pane allows and no taller than the room above the caption,
 * and moved so the drawing sits in the middle of the pane. The stage keeps
 * its own layout; only the view of it changes. */
export function heroFit(
  box: HeroBox,
  drawing: { left: number; right: number; height: number },
) {
  const width = drawing.right - drawing.left;

  const fit =
    width > 0 && drawing.height > 0
      ? Math.min(
          (box.width * WIDTH_SHARE) / width,
          Math.max(MIN_ROOM, box.room - BELOW) / drawing.height,
        )
      : 1;

  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit));

  return {
    zoom,
    x: box.width / 2 - (zoom * (drawing.left + drawing.right)) / 2,
  };
}
