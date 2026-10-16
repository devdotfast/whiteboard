import type {
  ReviewCanvasUi,
  ReviewMenuRequest,
  ReviewNotification,
} from "@dev.fast/review-protocol";
import { vi } from "vitest";

export function testCanvasUi() {
  let menu: ReviewMenuRequest;
  let notification: ReviewNotification | undefined;

  const close = (shown: ReviewNotification) => {
    if (notification !== shown) return;
    notification = undefined;
    shown.onClose?.();
  };

  const ui: ReviewCanvasUi = {
    confirmDelete: vi.fn<NonNullable<ReviewCanvasUi["confirmDelete"]>>(
      async () => true,
    ),
    notify: vi.fn<NonNullable<ReviewCanvasUi["notify"]>>((shown) => {
      if (notification) close(notification);
      notification = shown;

      return { dispose: () => close(shown) };
    }),
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
    get notification() {
      return notification;
    },
    runAction(label: string) {
      const shown = notification;
      const action = shown?.actions?.find((item) => item.label === label);

      if (!shown || !action)
        throw new Error(`Notification action missing: ${label}`);
      close(shown);
      action.run();
    },
    dismiss() {
      if (notification) close(notification);
    },
    async select(id: string) {
      if (!menu.items.some((item) => item.id === id && item.enabled !== false))
        throw new Error(`Menu item unavailable: ${id}`);
      menu.onHide();
      await menu.onSelect(id);
    },
  };
}
