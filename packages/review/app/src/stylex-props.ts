import * as stylex from "@stylexjs/stylex";

/** `stylex.props` plus a plain class: a marker that code, tests, style
 * conditions or global.css look up, kept alongside the StyleX classes. */
export function withClass(
  className: string,
  ...styles: stylex.StyleXArray<
    stylex.CompiledStyles | boolean | null | undefined
  >[]
) {
  const props = stylex.props(...styles);

  return {
    ...props,
    className: props.className ? `${className} ${props.className}` : className,
  };
}
