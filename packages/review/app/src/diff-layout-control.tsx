import type { ReviewDiffLayout } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { controlStyles } from "./controls-styles";
import { useCanvasMenu } from "./host/canvas-ui";
import { useReviewSession } from "./host/review-session";
import { SlidersIcon } from "./icons";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { captureClientError, captureUiEvent } from "./ui-telemetry";
import { useTooltip } from "./use-tooltip";

const LAYOUT_OPTIONS: ReadonlyArray<{
  layout: ReviewDiffLayout;
  label: string;
}> = [
  { layout: "unified", label: "Unified" },
  { layout: "split", label: "Split" },
];

export function DiffLayoutControl(): ReactElement {
  const tooltip = useTooltip("Diff settings");
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

  // The desktop confirms a write by round-tripping the setting through its
  // change event. The choice shows at once and holds until that confirmation,
  // or drops back if the write fails.
  const [pending, setPending] = useState<ReviewDiffLayout | null>(null);
  const shownLayout = pending ?? layout;

  useEffect(() => {
    if (pending !== null && layout === pending) setPending(null);
  }, [layout, pending]);

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

  const menu = useCanvasMenu({
    items: LAYOUT_OPTIONS.map((option) => ({
      id: option.layout,
      label: option.label,
      checked: option.layout === shownLayout,
    })),
    onSelect: (id) => {
      if (id === "unified" || id === "split") chooseLayout(id);
    },
  });

  return (
    <div {...stylex.props(shellStyles.topbarItem, styles.settings)}>
      <button
        type="button"
        {...stylex.props(styles.button)}
        aria-label="Diff settings"
        ref={tooltip}
        {...menu.triggerProps}
      >
        <SlidersIcon xstyle={controlStyles.chromeIcon} />
      </button>
    </div>
  );
}

const expanded = ':is([aria-expanded="true"])';

const styles = stylex.create({
  settings: {
    position: "relative",
  },
  button: {
    display: "grid",
    alignItems: "center",
    justifyContent: "center",
    width: tokens.chromeControlHeight,
    height: tokens.chromeControlHeight,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: tokens.chromeControlRadius,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.chromeHoverBg,
      ":focus-visible": tokens.chromeHoverBg,
      [expanded]: tokens.chromeHoverBg,
    },
    color: {
      default: tokens.chromeIconFg,
      ":hover": tokens.chromeFg,
      ":focus-visible": tokens.chromeFg,
      [expanded]: tokens.chromeFg,
    },
    cursor: "pointer",
    outline: {
      default: null,
      ":hover": "none",
      ":focus-visible": "none",
      [expanded]: "none",
    },
  },
});
