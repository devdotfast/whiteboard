import { radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { type ComponentProps, type RefCallback, useCallback } from "react";

const mixedBar = `linear-gradient(${tokens.onAccent}, ${tokens.onAccent})`;

type CheckboxProps = Omit<
  ComponentProps<"input">,
  "type" | "ref" | "className" | "style"
> & {
  indeterminate?: boolean;
  ref?: RefCallback<HTMLInputElement>;
  className?: string;
  xstyle?: StyleArg;
};

export function Checkbox({
  indeterminate = false,
  ref,
  className,
  xstyle,
  ...props
}: CheckboxProps) {
  const box = useCallback(
    (element: HTMLInputElement | null) => {
      if (element) element.indeterminate = indeterminate;

      return ref?.(element);
    },
    [indeterminate, ref],
  );

  return (
    <input
      type="checkbox"
      ref={box}
      {...props}
      {...withClass(className, styles.box, xstyle)}
    />
  );
}

/** Native radio behavior, with the same dimensions and palette as Checkbox. */
export function Radio({
  className,
  xstyle,
  ...props
}: Omit<CheckboxProps, "indeterminate">) {
  return (
    <input
      type="radio"
      {...props}
      {...withClass(className, styles.box, styles.radio, xstyle)}
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
    opacity: { default: null, ":disabled": 0.5 },
  },
  checked: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    backgroundImage: tokens.checkMark,
  },
  radio: {
    borderRadius: radius.round,
    // An unanswered radio group is also :indeterminate, but has no mixed mark.
    borderColor: {
      default: tokens.ruleSoft,
      ":checked": tokens.accent,
      ":indeterminate": tokens.ruleSoft,
    },
    backgroundColor: {
      default: tokens.surface,
      ":checked": tokens.accent,
      ":indeterminate": tokens.surface,
    },
    backgroundImage: {
      default: "none",
      ":checked": `radial-gradient(circle, ${tokens.onAccent} 3px, ${tokens.transparent} 3px)`,
      ":indeterminate": "none",
    },
    backgroundSize: { default: "100% 100%", ":indeterminate": "100% 100%" },
  },
  mixed: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    backgroundImage: mixedBar,
    backgroundSize: "8px 1.5px",
  },
});
