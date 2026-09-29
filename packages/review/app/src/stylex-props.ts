import * as stylex from "@stylexjs/stylex";

/** `stylex.props` for an element that keeps a class the plain CSS still styles. */
export function withClass(className: string, ...styles: stylex.StyleXStyles[]) {
  const props = stylex.props(...styles);

  return {
    ...props,
    className: props.className ? `${className} ${props.className}` : className,
  };
}
