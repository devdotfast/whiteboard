import * as stylex from "@stylexjs/stylex";
import type Katex from "katex";

import "katex/dist/katex.css";
import { type ReactElement, useLayoutEffect, useRef } from "react";

let katex: typeof Katex | undefined;

let loading: Promise<void> | undefined;

export function loadKatex() {
  return (loading ??= import("katex").then((module) => {
    katex = module.default;
  }));
}

/** KaTeX builds DOM nodes, so Trusted Types holds. Until it loads, the TeX shows as text. */
export function MarkdownMath({
  tex,
  display,
}: {
  tex: string;
  display: boolean;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const span = ref.current!;
    let live = true;

    // Untrusted TeX: the defaults refuse links, images, classes and styles.
    const render = () =>
      live &&
      katex!.render(tex, span, { displayMode: display, throwOnError: false });

    if (katex) render();
    else {
      span.textContent = tex;
      void loadKatex().then(render);
    }

    return () => {
      live = false;
    };
  }, [tex, display]);

  return <span ref={ref} {...stylex.props(display && styles.display)} />;
}

const styles = stylex.create({
  display: { display: "block", overflowX: "auto", overflowY: "hidden" },
});
