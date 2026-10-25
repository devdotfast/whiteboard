import { fontSize, layer, space } from "@canvas/scale.stylex";
import { IconButton } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { SlidersIcon } from "@canvas/ui/icons";
import { menuStyles } from "@canvas/ui/menu";
import { Popover } from "@canvas/ui/popover";
import { SegmentedControl, labeledOptions } from "@canvas/ui/segmented";
import { useTooltip } from "@canvas/ui/tooltip";
import type {
  ReviewDiffLayout,
  ReviewDiffLayoutScope,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
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
  const lineNumbers = useInlineLineNumbers();

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
          <div {...stylex.props(menuStyles.separator)} />
          <div {...stylex.props(styles.row)}>
            <span>Line numbers</span>
            <SegmentedControl
              label="Whiteboard line numbers"
              value={lineNumbers.show ? "show" : "hide"}
              options={labeledOptions({ hide: "Hide", show: "Show" })}
              onChange={(value) => lineNumbers.choose(value === "show")}
            />
          </div>
          <span {...stylex.props(styles.scope)}>
            Whiteboard document and peeks
          </span>
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
    gap: space.s8,
    padding: `${space.s10} ${space.s12}`,
    color: tokens.chromeFg,
    fontFamily: tokens.chromeFont,
    fontSize: tokens.chromeFontSize,
  },
  scope: { color: tokens.inkMuted, fontSize: fontSize.small },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s16,
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

function useInlineLineNumbers() {
  const session = useReviewSession();
  const bridge = session.bridge;

  const show = useSyncExternalStore(
    useCallback(
      (changed: () => void) => {
        const subscription = bridge.onDidChangeInlineLineNumbers(changed);

        return () => subscription.dispose();
      },
      [bridge],
    ),
    () => bridge.currentInlineLineNumbers(),
  );

  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (pending === show) setPending(null);
  }, [pending, show]);
  const shown = pending ?? show;

  const { mutate } = useMutation({
    mutationFn: (next: boolean) => bridge.setInlineLineNumbers(next),
    onError: (error) => {
      setPending(null);
      captureClientError(session, "settings", error, {
        component: "inline_line_numbers",
      });
    },
  });

  return {
    show: shown,
    choose: (next: boolean) => {
      if (next === shown) return;
      setPending(next);
      mutate(next);
    },
  };
}
