import { layer } from "@canvas/scale.stylex";
import { IconButton } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { SlidersIcon } from "@canvas/ui/icons";
import { Popover } from "@canvas/ui/popover";
import { SegmentedControl, labeledOptions } from "@canvas/ui/segmented";
import { useTooltip } from "@canvas/ui/tooltip";
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

const LAYOUT_OPTIONS = labeledOptions<ReviewDiffLayout>({
  unified: "Unified",
  split: "Split",
});

export function DiffLayoutControl(): ReactElement {
  const tooltip = useTooltip("Diff settings");

  const control = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const diff = useDiffLayout("diff");
  const peek = useDiffLayout("peek");

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
        <Popover
          anchor={control}
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label="Diff settings"
          xstyle={[shellStyles.topbarPopover, styles.popover]}
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
        </Popover>
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
