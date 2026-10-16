import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CheckIcon, ChevronDownIcon } from "@canvas/ui/icons";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { menuStyles, moveMenuFocus } from "./ui/menu";
import { Popover } from "./ui/popover";

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
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const setTrigger = useCallback(
    (element: HTMLButtonElement | null) => {
      trigger.current = element;

      return triggerRef?.(element);
    },
    [triggerRef],
  );

  const selectedIndex = options.findIndex((option) => option.value === value);

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
    <div {...stylex.props(styles.menu)}>
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
        <ChevronDownIcon xstyle={open && iconStyles.flip} />
      </button>
      {open && (
        <Popover
          ref={popup}
          anchor={trigger}
          onDismiss={close}
          role="menu"
          tabIndex={-1}
          aria-label={ariaLabel}
          xstyle={[
            menuStyles.popover,
            align === "end" && menuStyles.end,
            styles.options,
          ]}
          onKeyDown={(event) => {
            // Restore the trigger before the browser advances to the next control.
            if (event.key === "Tab") close();
            else moveMenuFocus(event);
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
                focusStyles.ringInset,
                buttonStyles.reset,
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
        </Popover>
      )}
    </div>
  );
}

const styles = stylex.create({
  menu: {
    position: "relative",
  },
  options: { minWidth: "160px" },
});
