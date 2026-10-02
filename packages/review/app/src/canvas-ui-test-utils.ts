import type {
  ReviewCanvasUi,
  ReviewMenuRequest,
} from "@dev.fast/review-protocol";
import { vi } from "vitest";

export function testCanvasUi() {
  let menu: ReviewMenuRequest;

  const ui: ReviewCanvasUi = {
    confirmDelete: vi.fn<(title: string) => Promise<boolean>>(async () => true),
    showMenu: vi.fn<ReviewCanvasUi["showMenu"]>((request) => {
      menu = request;

      return { dispose: vi.fn<() => void>() };
    }),
  };

  return {
    ui,
    get menu() {
      return menu;
    },
    async select(id: string) {
      if (!menu.items.some((item) => item.id === id && item.enabled !== false))
        throw new Error(`Menu item unavailable: ${id}`);
      menu.onHide();
      await menu.onSelect(id);
    },
  };
}
