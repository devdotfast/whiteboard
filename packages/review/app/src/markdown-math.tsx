import * as stylex from "@stylexjs/stylex";
import katex from "katex";

import "katex/dist/katex.css";
import { type ReactElement, useLayoutEffect, useRef } from "react";

/** KaTeX builds DOM nodes, so Trusted Types holds. */
export function MarkdownMath({
  tex,
  display,
}: {
  tex: string;
  display: boolean;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    // Untrusted TeX: the defaults refuse links, images, classes and styles.
    katex.render(tex, ref.current!, {
      displayMode: display,
      throwOnError: false,
    });
  }, [tex, display]);

  return <span ref={ref} {...stylex.props(display && styles.display)} />;
}

const styles = stylex.create({
  display: { display: "block", overflowX: "auto", overflowY: "hidden" },
});
