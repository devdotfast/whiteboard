import { MinusIcon, PlusIcon } from "@canvas/icons";
import { tokens } from "@canvas/tokens.stylex";
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
                      <kbd key={key} {...stylex.props(styles.key)}>
                        {key}
                      </kbd>
                    ))}
                  </span>
                  <span {...stylex.props(styles.itemLabel)}>{item.label}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
        <button
          ref={toggleRef}
          type="button"
          {...stylex.props(styles.button, styles.toggle)}
          aria-label="Minimize software map hotkeys"
          aria-expanded="true"
          tabIndex={open ? 0 : -1}
          onClick={() => onOpenChange(false)}
        >
          <MinusIcon xstyle={styles.icon} />
        </button>
      </div>
      <button
        ref={collapsedButtonRef}
        type="button"
        {...stylex.props(
          styles.button,
          styles.collapsedButton,
          !open && styles.collapsedButtonShown,
        )}
        aria-label="Show software map hotkeys"
        aria-expanded="false"
        tabIndex={open ? -1 : 0}
        onClick={() => onOpenChange(true)}
      >
        <span>Hotkeys</span>
        <PlusIcon xstyle={styles.icon} />
      </button>
    </aside>
  );
}

// Keeps the map's own keys off the panel's buttons. Modifier chords such as
// Ctrl+Tab still reach the workbench keybindings on window.
function stopSoftwareMapHotkeysKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  event.stopPropagation();
}

const settle = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

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
    borderRadius: "8px 8px 0 0",
    backgroundColor: tokens.surface,
    color: tokens.ink,
    boxShadow: `0 -8px 24px ${tokens.shadowColorStrong}`,
    fontSize: "11px",
    lineHeight: 1,
    transform: "translateX(-50%)",
    transition: {
      default: `width 180ms ${settle}, box-shadow 180ms ease`,
      [reducedMotion]: "none",
    },
    willChange: "width",
  },
  tabCollapsed: {
    boxShadow: `0 -4px 14px ${tokens.shadowColorStrong}`,
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
      default: `opacity 140ms ease, transform 180ms ${settle}`,
      [reducedMotion]: "none",
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
    gap: "12px",
    alignItems: "center",
    minWidth: 0,
    height: "100%",
    padding: "0 8px 0 10px",
    overflowX: "auto",
    scrollbarWidth: "none",
    "::-webkit-scrollbar": {
      display: "none",
    },
  },
  group: {
    display: "flex",
    flex: "0 0 auto",
    gap: "6px",
    alignItems: "center",
    minWidth: 0,
    whiteSpace: "nowrap",
  },
  groupLabel: {
    color: tokens.inkFaint,
    fontSize: "10px",
    fontWeight: 650,
    letterSpacing: 0,
  },
  groupLabelActive: {
    color: tokens.accent,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    color: tokens.inkMuted,
  },
  keys: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
  },
  key: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: "16px",
    height: "17px",
    padding: "0 4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "4px",
    backgroundColor: tokens.bg,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    lineHeight: 1,
  },
  itemLabel: {
    color: tokens.inkFaint,
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    height: "100%",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    color: {
      default: tokens.inkFaint,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    cursor: "pointer",
    outline: {
      default: null,
      ":focus-visible": `1px solid ${tokens.ruleSoft}`,
    },
    outlineOffset: { default: null, ":focus-visible": "-3px" },
  },
  toggle: {
    flex: "0 0 28px",
    justifyContent: "center",
    width: "28px",
    padding: 0,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.ruleSoft,
  },
  collapsedButton: {
    position: "absolute",
    inset: "0 auto 0 0",
    gap: "6px",
    padding: "0 10px",
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    font: "inherit",
    opacity: 0,
    pointerEvents: "none",
    transform: "translateY(-3px)",
    transition: {
      default: `opacity 140ms ease, transform 180ms ${settle}`,
      [reducedMotion]: "none",
    },
  },
  collapsedButtonShown: {
    opacity: 1,
    pointerEvents: "auto",
    transform: "translateY(0)",
  },
  icon: {
    width: "14px",
    height: "14px",
    pointerEvents: "none",
  },
});
