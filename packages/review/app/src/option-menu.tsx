import { type ReactNode, useEffect, useRef, useState } from "react";

import { useCanvasMenu } from "./host/canvas-ui";
import { useDismissOnOutside } from "./use-dismiss-on-outside";

/** A single-choice menu; the caller renders the trigger's content. */
export function OptionMenu<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className,
  triggerClassName,
  triggerProps,
  children,
}: {
  ariaLabel: string;
  value: T | undefined;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange(value: T): void;
  className: string;
  triggerClassName: string;
  triggerProps?: { "aria-pressed"?: boolean };
  children: ReactNode;
}) {
  const [fallbackOpen, setOpen] = useState(false);
  const menu = useCanvasMenu();
  const open = menu.available ? menu.open : fallbackOpen;
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", time: 0 });

  useEffect(() => {
    if (fallbackOpen) {
      const items = container.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      );

      const selected = options.findIndex((option) => option.value === value);
      items?.[Math.max(0, selected)]?.focus();
    }
  }, [fallbackOpen]);

  useDismissOnOutside(container, fallbackOpen, setOpen);

  const show = () => {
    if (!menu.available) {
      setOpen(!fallbackOpen);

      return;
    }

    if (trigger.current)
      menu.show({
        anchor: trigger.current,
        items: options.map((option) => ({
          id: option.value,
          label: option.label,
          checked: option.value === value,
        })),
        onSelect: (id) => {
          const option = options.find((option) => option.value === id);

          if (option) onChange(option.value);
        },
      });
  };

  return (
    <div
      className={`review-option-menu ${className}`}
      ref={container}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className={triggerClassName}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        {...triggerProps}
      >
        {children}
        <svg
          className="review-option-menu-chevron"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d={open ? "m5 12 5-5 5 5" : "m5 8 5 5 5-5"} />
        </svg>
      </button>
      {!menu.available && fallbackOpen ? (
        <div
          role="menu"
          tabIndex={-1}
          aria-label={ariaLabel}
          className="review-option-menu-options"
          onKeyDown={(event) => {
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]',
              ),
            ];

            const index = items.findIndex(
              (item) =>
                item === event.currentTarget.ownerDocument.activeElement,
            );

            let next: number | undefined;

            if (event.key === "ArrowDown") next = (index + 1) % items.length;
            else if (event.key === "ArrowUp")
              next = (index + items.length - 1) % items.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = items.length - 1;
            else if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              const now = Date.now();
              search.current.text =
                (now - search.current.time < 500 ? search.current.text : "") +
                event.key.toLowerCase();
              search.current.time = now;
              next = items.findIndex((item) =>
                item.textContent
                  ?.trim()
                  .toLowerCase()
                  .startsWith(search.current.text),
              );
            } else if (event.key === "Tab") setOpen(false);

            if (next !== undefined && next >= 0) {
              event.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {option.icon}
              <span>{option.label}</span>
              {option.value === value ? (
                <svg
                  className="review-option-menu-check"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="m5 10 3.5 3.5L15 6.5" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
