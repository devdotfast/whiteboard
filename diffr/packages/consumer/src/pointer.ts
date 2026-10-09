import type { Frame, Input } from "./protocol";
import type { Hover } from "@diffr/viewer/viewer";
import { targetAt } from "@diffr/viewer/viewport/cell";

interface Pointer {
  type: "down" | "drag" | "up" | "move" | "leave";
  x: number;
  y: number;
  alt?: boolean;
}

/** Coordinates belong to the last painted frame, never to terminal scrollback. */
export class PointerInput {
  private dragging = false;

  reset() { this.dragging = false; }

  read(frame: Frame, event: Pointer): { input?: Input; hover?: Hover | null } {
    const line = frame.lines[event.y];
    if (event.type === "up" || event.type === "leave") {
      this.dragging = false;
      return event.type === "leave" ? { hover: null } : {};
    }
    if (event.type === "move") return { hover: targetAt(line?.hovers ?? [], event.x) ?? null };
    if (event.type === "down") {
      const act = targetAt(line?.hits ?? [], event.x);
      this.dragging = !act;
      return { input: act ? { act, ...(event.alt ? { alt: true } : {}) } : { select: { x: event.x, y: event.y } } };
    }
    return this.dragging ? { input: { select: { x: event.x, y: event.y, extend: true } } } : {};
  }
}
