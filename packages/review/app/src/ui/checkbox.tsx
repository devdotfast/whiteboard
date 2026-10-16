import { radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

const mixedBar = `linear-gradient(${tokens.onAccent}, ${tokens.onAccent})`;

type CheckboxProps = Omit<
  ComponentProps<"input">,
  "type" | "ref" | "className" | "style"
> & {
  indeterminate?: boolean;
  className?: string;
  xstyle?: StyleArg;
};

export function Checkbox({
  indeterminate = false,
  className,
  xstyle,
  ...props
}: CheckboxProps) {
  return (
    <input
      type="checkbox"
      ref={(element) => {
        if (element) element.indeterminate = indeterminate;
      }}
      {...props}
      {...withClass(className, styles.box, xstyle)}
    />
  );
}

/** The box alone, for a row that is itself the checkbox (a menuitemcheckbox). */
export function CheckboxMark({
  state,
  xstyle,
}: {
  state: boolean | "mixed";
  xstyle?: StyleArg;
}) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.box,
        state === true && styles.checked,
        state === "mixed" && styles.mixed,
        xstyle,
      )}
    />
  );
}

const styles = stylex.create({
  box: {
    flex: "none",
    boxSizing: "border-box",
    width: "14px",
    height: "14px",
    margin: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.ruleSoft,
      ":checked": tokens.accent,
      ":indeterminate": tokens.accent,
    },
    borderRadius: radius.small,
    backgroundColor: {
      default: tokens.surface,
      ":checked": tokens.accent,
      ":indeterminate": tokens.accent,
    },
    backgroundImage: {
      default: "none",
      ":checked": tokens.checkMark,
      ":indeterminate": mixedBar,
    },
    backgroundPosition: "center",
    backgroundSize: { default: "10px 10px", ":indeterminate": "8px 1.5px" },
    backgroundRepeat: "no-repeat",
    appearance: "none",
    cursor: { default: "pointer", ":disabled": "default" },
  },
  checked: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    backgroundImage: tokens.checkMark,
  },
  mixed: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    backgroundImage: mixedBar,
    backgroundSize: "8px 1.5px",
  },
});
