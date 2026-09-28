import type { ReviewDiffLayout } from "@dev.fast/review-protocol";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useCanvasMenu } from "./host/canvas-ui";
import { useReviewSession } from "./host/review-session";
import { SlidersIcon, SplitLayoutIcon, UnifiedLayoutIcon } from "./icons";
import { captureClientError, captureUiEvent } from "./ui-telemetry";
import { useDismissOnOutside } from "./use-dismiss-on-outside";
import { useTooltip } from "./use-tooltip";
import { useTopbarPopover } from "./use-topbar-popover";

const LAYOUT_OPTIONS: ReadonlyArray<{
  layout: ReviewDiffLayout;
  label: string;
  Icon: () => ReactElement;
}> = [
  { layout: "unified", label: "Unified", Icon: UnifiedLayoutIcon },
  { layout: "split", label: "Split", Icon: SplitLayoutIcon },
];

export function DiffLayoutControl(): ReactElement {
  const tooltip = useTooltip("Diff settings");
  const menu = useCanvasMenu();
  const session = useReviewSession();
  const bridge = session.bridge;

  const layout = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        const subscription = bridge.onDidChangeDiffLayout(onChange);

        return () => subscription.dispose();
      },
      [bridge],
    ),
    () => bridge.currentDiffLayout(),
  );

  const controlRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const popoverRef = useTopbarPopover(open, controlRef);
  // The desktop confirms a write by round-tripping the setting through its
  // change event. The choice shows at once and holds until that confirmation,
  // or drops back if the write fails.
  const [pending, setPending] = useState<ReviewDiffLayout | null>(null);
  const shownLayout = pending ?? layout;
  const layoutLabelId = useId();

  useEffect(() => {
    if (pending !== null && layout === pending) setPending(null);
  }, [layout, pending]);

  useDismissOnOutside(controlRef, open, setOpen, true, true);

  const chooseLayout = (next: ReviewDiffLayout) => {
    if (next === shownLayout) return;
    captureUiEvent(session, "diff_layout_changed", { layout: next });
    setPending(next);
    bridge.setDiffLayout(next).catch((error: Error) => {
      setPending(null);
      captureClientError(session, "settings", error, {
        component: "diff_layout",
      });
    });
  };

  return (
    <div ref={controlRef} className="review-diff-settings">
      <button
        type="button"
        className="review-diff-settings-button"
        aria-label="Diff settings"
        ref={tooltip}
        aria-haspopup={menu.available ? "menu" : "dialog"}
        aria-expanded={menu.available ? menu.open : open}
        onClick={(event) => {
          if (menu.available)
            menu.show({
              anchor: event.currentTarget,
              items: LAYOUT_OPTIONS.map((option) => ({
                id: option.layout,
                label: option.label,
                checked: option.layout === shownLayout,
              })),
              onSelect: (id) => {
                if (id === "unified" || id === "split") chooseLayout(id);
              },
            });
          else setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      >
        <SlidersIcon />
      </button>
      {open ? (
        <div
          ref={popoverRef}
          popover="manual"
          className="review-diff-settings-popover"
          role="dialog"
          aria-label="Diff settings"
        >
          <div className="review-diff-settings-title">Diff settings</div>
          <div className="review-diff-settings-field">
            <span id={layoutLabelId} className="review-diff-settings-label">
              Layout
            </span>
            <div
              className="review-segmented review-diff-settings-segmented"
              role="radiogroup"
              aria-labelledby={layoutLabelId}
            >
              {LAYOUT_OPTIONS.map(({ layout: option, label, Icon }) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={option === shownLayout}
                  className={
                    option === shownLayout
                      ? "review-segment review-segment--active"
                      : "review-segment"
                  }
                  onClick={() => chooseLayout(option)}
                >
                  <Icon />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
