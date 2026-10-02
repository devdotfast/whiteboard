import * as stylex from "@stylexjs/stylex";

/** Anything `stylex.props` takes, markers included. */
export type StyleArg = stylex.StyleXArray<
  | stylex.CompiledStyles
  | Readonly<[stylex.CompiledStyles, stylex.InlineStyles]>
  | boolean
  | null
  | undefined
>;

/** `stylex.props` plus a plain class: a marker that code, tests, style
 * conditions or global.css look up, kept alongside the StyleX classes. */
export function withClass(
  className: string | undefined,
  ...styles: StyleArg[]
) {
  const props = stylex.props(...styles);

  return {
    ...props,
    className:
      [className, props.className].filter(Boolean).join(" ") || undefined,
  };
}
