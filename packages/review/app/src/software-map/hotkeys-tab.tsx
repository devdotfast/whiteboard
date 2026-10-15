import {
  elevation,
  fontSize,
  fontWeight,
  leading,
  motion,
  radius,
  space,
} from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { MinusIcon, PlusIcon } from "@canvas/ui/icons";
import { Kbd } from "@canvas/ui/kbd";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface SoftwareMapHotkeyItem {
  keys: readonly string[];
  label: string;
}

export interface SoftwareMapHotkeyGroup {
  id: string;
  label: string;
  items: readonly SoftwareMapHotkeyItem[];
}

interface SoftwareMapHotkeysTabProps {
  groups: readonly SoftwareMapHotkeyGroup[];
  activeGroupId: string;
  open: boolean;
  ariaLabel: string;
  onOpenChange: (open: boolean) => void;
}

export function SoftwareMapHotkeysTab({
  groups,
  activeGroupId,
  open,
  ariaLabel,
  onOpenChange,
}: SoftwareMapHotkeysTabProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const collapsedButtonRef = useRef<HTMLButtonElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  const measureWidth = useCallback(() => {
    const root = rootRef.current;
    const strip = stripRef.current;
    const toggle = toggleRef.current;
    const collapsedButton = collapsedButtonRef.current;

    if (!root || !strip || !toggle || !collapsedButton) {
      return;
    }

    const styles = getComputedStyle(root);

    const borderWidth =
      Number.parseFloat(styles.borderLeftWidth) +
      Number.parseFloat(styles.borderRightWidth);

    const openWidth = strip.scrollWidth + toggle.offsetWidth + borderWidth;
    const collapsedWidth = collapsedButton.scrollWidth + borderWidth;
    const nextWidth = Math.ceil(open ? openWidth : collapsedWidth);

    setMeasuredWidth((currentWidth) =>
      currentWidth === nextWidth ? currentWidth : nextWidth,
    );
  }, [open]);

  useLayoutEffect(() => {
    measureWidth();
  }, [measureWidth, groups, activeGroupId]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => measureWidth());

    const observedElements = [
      stripRef.current,
      toggleRef.current,
      collapsedButtonRef.current,
    ];

    for (const element of observedElements) {
      if (element) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [measureWidth]);

  // SAFETY: React passes "--*" keys through to style.setProperty; CSSProperties
  // only lacks an index signature for custom properties.
  const style =
    measuredWidth === null
      ? undefined
      : ({
          "--software-map-hotkeys-width": `${measuredWidth}px`,
        } as CSSProperties);

  return (
    <aside
      ref={rootRef}
      {...stylex.props(styles.tab, !open && styles.tabCollapsed)}
      aria-label={open ? ariaLabel : undefined}
      style={style}
      onKeyDown={stopSoftwareMapHotkeysKeyDown}
    >
      <div
        {...stylex.props(styles.panel, !open && styles.panelCollapsed)}
        aria-hidden={!open}
      >
        <div ref={stripRef} {...stylex.props(styles.strip)}>
          {groups.map((group) => (
            <div key={group.id} {...stylex.props(styles.group)}>
              <span
                {...stylex.props(
                  styles.groupLabel,
                  group.id === activeGroupId && styles.groupLabelActive,
                )}
              >
                {group.label}
              </span>
              {group.items.map((item) => (
                <span
                  key={`${group.id}:${item.label}`}
                  {...stylex.props(styles.item)}
                  title={item.label}
                >
                  <span {...stylex.props(styles.keys)}>
                    {item.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                  <span {...stylex.props(styles.itemLabel)}>{item.label}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
        <IconButton
          ref={toggleRef}
          xstyle={styles.toggle}
          aria-label="Minimize software map hotkeys"
          aria-expanded="true"
          tabIndex={open ? 0 : -1}
          onClick={() => onOpenChange(false)}
        >
          <MinusIcon xstyle={[iconStyles.inert, iconStyles.chrome]} />
        </IconButton>
      </div>
      <Button
        ref={collapsedButtonRef}
        variant="ghost"
        xstyle={[styles.collapsedButton, !open && styles.collapsedButtonShown]}
        aria-label="Show software map hotkeys"
        aria-expanded="false"
        tabIndex={open ? -1 : 0}
        onClick={() => onOpenChange(true)}
      >
        <span>Hotkeys</span>
        <PlusIcon xstyle={[iconStyles.inert, iconStyles.chrome]} />
      </Button>
    </aside>
  );
}

// Keeps the map's own keys off the panel's buttons. Modifier chords such as
// Ctrl+Tab still reach the workbench keybindings on window.
function stopSoftwareMapHotkeysKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  event.stopPropagation();
}

const styles = stylex.create({
  // A tab docked to the bottom edge, sized to its content.
  tab: {
    position: "absolute",
    bottom: 0,
    left: "50%",
    zIndex: 7,
    display: "flex",
    alignItems: "center",
    width: {
      default: "var(--software-map-hotkeys-width, max-content)",
      "@media (max-width: 760px)": "calc(100% - 24px)",
    },
    maxWidth: {
      default: "calc(100% - 24px)",
      "@media (max-width: 760px)": "none",
    },
    height: "30px",
    minWidth: 0,
    overflow: "hidden",
    borderWidth: "1px 1px 0",
    borderStyle: "solid solid none",
    borderColor: `${tokens.rule} ${tokens.rule} currentcolor`,
    borderRadius: `${radius.surface} ${radius.surface} 0 0`,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    boxShadow: elevation.dock,
    fontSize: fontSize.small,
    lineHeight: leading.none,
    transform: "translateX(-50%)",
    transition: {
      default: `width ${motion.medium} ${motion.settle}, box-shadow ${motion.medium} ${motion.ease}`,
      [stylex.env.reducedMotion]: "none",
    },
    willChange: "width",
  },
  tabCollapsed: {
    boxShadow: elevation.dockCollapsed,
  },
  panel: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: "100%",
    minWidth: 0,
    opacity: 1,
    transform: "translateY(0)",
    transition: {
      default: `opacity ${motion.fast} ${motion.ease}, transform ${motion.medium} ${motion.settle}`,
      [stylex.env.reducedMotion]: "none",
    },
  },
  panelCollapsed: {
    opacity: 0,
    pointerEvents: "none",
    transform: "translateY(4px)",
  },
  strip: {
    display: "flex",
    flex: "1 1 auto",
    gap: space.s12,
    alignItems: "center",
    minWidth: 0,
    height: "100%",
    padding: `0 ${space.s8} 0 ${space.s10}`,
    overflowX: "auto",
    scrollbarWidth: "none",
    "::-webkit-scrollbar": {
      display: "none",
    },
  },
  group: {
    display: "flex",
    flex: "0 0 auto",
    gap: space.s6,
    alignItems: "center",
    minWidth: 0,
    whiteSpace: "nowrap",
  },
  groupLabel: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0,
  },
  groupLabelActive: {
    color: tokens.accent,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s4,
    color: tokens.inkMuted,
  },
  keys: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
  },
  itemLabel: {
    color: tokens.inkFaint,
  },
  toggle: {
    flex: "0 0 28px",
    width: "28px",
    height: "100%",
    borderRadius: 0,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.ruleSoft,
  },
  collapsedButton: {
    position: "absolute",
    inset: "0 auto 0 0",
    height: "100%",
    borderRadius: 0,
    fontSize: fontSize.small,
    opacity: 0,
    pointerEvents: "none",
    transform: "translateY(-3px)",
    transition: {
      default: `opacity ${motion.fast} ${motion.ease}, transform ${motion.medium} ${motion.settle}`,
      [stylex.env.reducedMotion]: "none",
    },
  },
  collapsedButtonShown: {
    opacity: 1,
    pointerEvents: "auto",
    transform: "translateY(0)",
  },
});
