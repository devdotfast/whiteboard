import { layer } from "@canvas/scale.stylex";
import { IconButton } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { SlidersIcon } from "@canvas/ui/icons";
import { SegmentedControl, labeledOptions } from "@canvas/ui/segmented";
import { surfaceStyles } from "@canvas/ui/surface";
import type {
  ReviewDiffLayout,
  ReviewDiffLayoutScope,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useReviewSession } from "./host/review-session";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { captureClientError, captureUiEvent } from "./ui-telemetry";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismissOnOutside } from "./use-dismiss-on-outside";
import { useTooltip } from "./use-tooltip";

const LAYOUT_OPTIONS = labeledOptions<ReviewDiffLayout>({
  unified: "Unified",
  split: "Split",
});

export function DiffLayoutControl(): ReactElement {
  const tooltip = useTooltip("Diff settings");

  const control = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const popoverRef = useAnchoredPopover(open, control);
  const diff = useDiffLayout("diff");
  const peek = useDiffLayout("peek");

  useDismissOnOutside(control, open, setOpen, true, true);

  return (
    <div
      ref={control}
      {...stylex.props(shellStyles.topbarItem, styles.settings)}
    >
      <IconButton
        aria-label="Diff settings"
        ref={tooltip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <SlidersIcon xstyle={iconStyles.chrome} />
      </IconButton>
      {open && (
        <div
          ref={popoverRef}
          popover="manual"
          role="dialog"
          aria-label="Diff settings"
          {...stylex.props(
            shellStyles.topbarPopover,
            surfaceStyles.popover,
            styles.popover,
          )}
        >
          {(
            [
              ["Diff", diff],
              ["Whiteboard", peek],
            ] as const
          ).map(([label, layout]) => (
            <div key={label} {...stylex.props(styles.row)}>
              <span>{label}</span>
              <SegmentedControl
                label={`${label} layout`}
                value={layout.layout}
                options={LAYOUT_OPTIONS}
                onChange={layout.choose}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = stylex.create({
  settings: {
    position: "relative",
  },
  popover: {
    zIndex: layer.popover,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 12px",
    color: tokens.chromeFg,
    fontFamily: tokens.chromeFont,
    fontSize: tokens.chromeFontSize,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
  },
});

function useDiffLayout(scope: ReviewDiffLayoutScope) {
  const session = useReviewSession();
  const bridge = session.bridge;

  const layout = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        const subscription = bridge.onDidChangeDiffLayout(scope, onChange);

        return () => subscription.dispose();
      },
      [bridge, scope],
    ),
    () => bridge.currentDiffLayout(scope),
  );

  // The desktop confirms a write by round-tripping the setting through its
  // change event. The choice shows at once and holds until that confirmation,
  // or drops back if the write fails.
  const [pending, setPending] = useState<ReviewDiffLayout | null>(null);
  const shownLayout = pending ?? layout;

  useEffect(() => {
    if (pending !== null && layout === pending) setPending(null);
  }, [layout, pending]);

  const choose = (next: ReviewDiffLayout) => {
    if (next === shownLayout) return;
    captureUiEvent(session, "diff_layout_changed", { layout: next, scope });
    setPending(next);
    bridge.setDiffLayout(scope, next).catch((error: Error) => {
      setPending(null);
      captureClientError(session, "settings", error, {
        component: "diff_layout",
      });
    });
  };

  return { layout: shownLayout, choose };
}
