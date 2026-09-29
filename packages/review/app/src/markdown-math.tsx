import * as stylex from "@stylexjs/stylex";
import katex from "katex";

import "katex/dist/katex.css";
import { type ReactElement, useLayoutEffect, useRef } from "react";

/** TeX math typeset by KaTeX, which builds DOM nodes and injects no HTML. */
export function MarkdownMath({
  tex,
  display,
}: {
  tex: string;
  display: boolean;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    // TeX here is untrusted runtime text. KaTeX's defaults refuse the commands
    // that emit links, images, classes or styles.
    katex.render(tex, ref.current!, {
      displayMode: display,
      throwOnError: false,
    });
  }, [tex, display]);

  return <span ref={ref} {...stylex.props(display && styles.display)} />;
}

const styles = stylex.create({
  // A wide equation scrolls instead of widening the document.
  display: { display: "block", overflowX: "auto", overflowY: "hidden" },
});
