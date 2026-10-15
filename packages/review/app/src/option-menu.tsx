import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { CheckIcon } from "./icons";
import { menuStyles, moveMenuFocus } from "./ui/menu";
import { surfaceStyles } from "./ui/surface";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismissOnOutside } from "./use-dismiss-on-outside";

/** A single-choice menu; the caller renders the trigger's content. */
export function OptionMenu<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  triggerStyle,
  triggerProps,
  triggerRef,
  align = "end",
  children,
}: {
  ariaLabel: string;
  value: T | undefined;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange(value: T): void;
  triggerStyle?: stylex.StyleXStyles;
  triggerProps?: { "aria-pressed"?: boolean };
  triggerRef?: RefCallback<HTMLButtonElement>;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const setTrigger = useCallback(
    (element: HTMLButtonElement | null) => {
      trigger.current = element;

      return triggerRef?.(element);
    },
    [triggerRef],
  );

  const popup = useAnchoredPopover(open, trigger);
  const selectedIndex = options.findIndex((option) => option.value === value);
  useDismissOnOutside(container, open, () => setOpen(false));

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;

    const items = popup.current?.querySelectorAll<HTMLElement>(
      '[role="menuitemradio"]',
    );

    items?.[Math.max(0, selectedIndex)]?.focus();
  }, [open, popup, selectedIndex]);

  return (
    <div ref={container} {...stylex.props(styles.menu)}>
      <button
        {...stylex.props(triggerStyle)}
        type="button"
        aria-label={ariaLabel}
        ref={setTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        {...triggerProps}
      >
        {children}
        <svg
          {...stylex.props(styles.chevron)}
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d={open ? "m5 12 5-5 5 5" : "m5 8 5 5 5-5"} />
        </svg>
      </button>
      {open && (
        <div
          ref={popup}
          popover="manual"
          role="menu"
          tabIndex={-1}
          aria-label={ariaLabel}
          {...stylex.props(
            surfaceStyles.popover,
            menuStyles.popover,
            align === "end" && menuStyles.end,
            styles.options,
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Tab") {
              // Restore the trigger before the browser advances to the next control.
              close();
            } else moveMenuFocus(event);
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={option.value === value ? 0 : -1}
              {...stylex.props(
                menuStyles.item,
                option.value === value && menuStyles.itemCurrent,
              )}
              onClick={() => {
                onChange(option.value);
                close();
              }}
            >
              {option.icon}
              {option.label}
              {option.value === value && (
                <CheckIcon xstyle={menuStyles.check} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = stylex.create({
  menu: {
    position: "relative",
  },
  options: { minWidth: "160px" },
  chevron: {
    width: "12px",
    height: "12px",
    flexShrink: 0,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
});
