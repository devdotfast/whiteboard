import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { useCanvasMenu } from "./host/canvas-ui";
import { withClass } from "./stylex-props";

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
  const menu = useCanvasMenu({
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

  return (
    <div {...withClass(className, styles.menu)}>
      <button
        className={triggerClassName}
        type="button"
        aria-label={ariaLabel}
        {...menu.triggerProps}
        {...triggerProps}
      >
        {children}
        <svg
          {...stylex.props(styles.chevron)}
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d={menu.open ? "m5 12 5-5 5 5" : "m5 8 5 5 5-5"} />
        </svg>
      </button>
    </div>
  );
}

const styles = stylex.create({
  menu: {
    position: "relative",
  },
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
