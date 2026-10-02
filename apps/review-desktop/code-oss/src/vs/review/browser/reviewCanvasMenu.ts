import type { IAction } from "../../base/common/actions.js";
import type { IContextMenuService, IContextViewService } from "../../platform/contextview/browser/contextView.js";
import type { ReviewMenuRequest, ReviewDisposable } from "../common/reviewProtocol.js";

let nextMenuId = 0;

export function showReviewCanvasMenu(
  service: Pick<IContextMenuService, "showContextMenu">,
  request: ReviewMenuRequest,
  isCurrent: () => boolean,
  views: Pick<IContextViewService, "getContextViewElement" | "hideContextView">,
): ReviewDisposable {
  const menuClass = `review-canvas-menu-${++nextMenuId}`;
  let disposed = false;
  let hidden = false;
  let selected = false;
  const active = () => !disposed && isCurrent() && request.anchor.isConnected;
  const actions: IAction[] = request.items.map(item => ({
    id: `review.canvas.${item.id}`,
    label: item.label,
    tooltip: "",
    class: undefined,
    enabled: item.enabled !== false,
    checked: item.checked,
    async run() {
      if (!active() || hidden || selected || item.enabled === false) return;
      selected = true;
      await request.onSelect(item.id);
    },
  }));
  service.showContextMenu({
    getAnchor: () => request.anchor,
    getMenuClassName: () => menuClass,
    getActions: () => actions,
    getCheckedActionsRepresentation: () => "radio",
    autoSelectFirstItem: true,
    skipTelemetry: true,
    onHide: () => {
      // Native and HTML menus hide before invoking the selected action.
      queueMicrotask(() => {
        if (hidden) return;
        hidden = true;
        if (disposed) return;
        request.onHide();
        if (!active()) return;
        const doc = request.anchor.ownerDocument;
        const focused = doc.activeElement;
        if (!selected && (focused === doc.body || focused === request.anchor || focused?.closest(".context-view"))) {
          request.anchor.focus();
        }
      });
    },
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!hidden) {
        hidden = true;
        request.onHide();
        // Only close our HTML menu. Native menus have no close handle.
        if (views.getContextViewElement().classList.contains(menuClass)) {
          views.hideContextView(true);
        }
      }
    },
  };
}
