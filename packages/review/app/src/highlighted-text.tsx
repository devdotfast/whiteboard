import { radius } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { withClass } from "./stylex-props";

export function findWhitespaceNormalizedSpan(
  text: string,
  quote: string,
): { start: number; end: number } | null {
  const trimmedQuote = quote.trim();

  if (!trimmedQuote || !text) return null;
  const normQuote = trimmedQuote.replace(/\s+/g, " ");

  let normText = "";
  const normToOriginalStart: number[] = [];
  const normToOriginalEnd: number[] = [];

  let i = 0;

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      const spaceStart = i;

      while (i < text.length && /\s/.test(text[i])) {
        i++;
      }

      normToOriginalStart.push(spaceStart);
      normToOriginalEnd.push(i);
      normText += " ";
    } else {
      normToOriginalStart.push(i);
      normToOriginalEnd.push(i + 1);
      normText += text[i];
      i++;
    }
  }

  const matchIdx = normText.indexOf(normQuote);

  if (matchIdx === -1) {
    return null;
  }

  const origStart = normToOriginalStart[matchIdx];
  const origEnd = normToOriginalEnd[matchIdx + normQuote.length - 1];

  return { start: origStart, end: origEnd };
}

export function HighlightedText({
  text,
  quote,
}: {
  text: string;
  quote: string;
}): ReactNode {
  const span = findWhitespaceNormalizedSpan(text, quote);

  if (!span) {
    return text;
  }

  return (
    <>
      {text.slice(0, span.start)}
      <QuoteMark>{text.slice(span.start, span.end)}</QuoteMark>
      {text.slice(span.end)}
    </>
  );
}

/** A quoted run of trace text. Scrolling to a quote looks for its class. */
export function QuoteMark({ children }: { children: ReactNode }) {
  return (
    <mark {...withClass("review-trace-quote-mark", styles.mark)}>
      {children}
    </mark>
  );
}

const styles = stylex.create({
  mark: {
    backgroundColor: "rgba(255, 230, 0, 0.35)",
    color: "inherit",
    borderRadius: radius.hairline,
    padding: "1px 2px",
  },
});
