import type { ReviewComponentProps } from "@review/review-document-data";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, isValidElement } from "react";

import { isReactTextNode } from "./agent-markdown";
import { drawStyles } from "./draw-styles";
import { documentMarker } from "./markers.stylex";
import { ProsePeekAnchor } from "./review-components";
import { useOptionalReviewPanel } from "./review-panel";
import { tokens } from "./tokens.stylex";

function extractText(node: ReactNode): string {
  if (isReactTextNode(node)) return String(node);

  if (Array.isArray(node)) return node.map(extractText).join("");

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }

  return "";
}

export function TraceQuote({
  sessionId,
  trace,
  event,
  children,
}: ReviewComponentProps<"TraceQuote"> & { children?: ReactNode }) {
  const quote = extractText(children);
  const openPeek = useOptionalReviewPanel((state) => state.openPeek);

  const isOpen =
    useOptionalReviewPanel((state) => {
      const active = state.active;

      return (
        active?.kind === "peek" &&
        active.content.kind === "trace-quote" &&
        active.content.sessionId === sessionId &&
        active.content.quote === quote &&
        active.content.trace === trace
      );
    }) ?? false;

  const href = `#trace-${sessionId}${trace ? `-${trace}` : ""}${event !== undefined ? `-event-${event}` : ""}`;

  return (
    <span {...stylex.props(styles.container, drawStyles.blockChild)}>
      <ProsePeekAnchor
        href={href}
        xstyle={[styles.quote, isOpen && styles.open]}
        isOpen={isOpen}
        inertFallback={
          <span {...stylex.props(styles.quote, styles.inert)}>{children}</span>
        }
        onOpen={() => {
          openPeek?.({
            kind: "peek",
            content: {
              kind: "trace-quote",
              sessionId,
              trace,
              event,
              quote,
            },
          });
        }}
        onAlreadyOpen={() => {
          const targetTurn = document.getElementById(
            "review-trace-target-event",
          );

          const quoteMark = targetTurn?.querySelector(
            ".review-trace-quote-mark",
          );

          const el = quoteMark ?? targetTurn;
          // jsdom has no scrollIntoView, so the call stays optional.
          el?.scrollIntoView?.({ block: "center", behavior: "auto" });
        }}
      >
        {children}
      </ProsePeekAnchor>
    </span>
  );
}

const inDocument = () => stylex.when.ancestor(":is(*)", documentMarker);

// A block's own element: a child of the block's node.
const inDocumentBlock = () => `${inDocument()}:is([data-review-node-id] > *)`;

const styles = stylex.create({
  // A quote block stands in the prose column; a quote in prose stays inline.
  container: {
    display: { default: null, [inDocumentBlock()]: "block" },
    width: {
      default: null,
      [inDocumentBlock()]: `min(100%, ${tokens.reviewProseMaxWidth})`,
    },
    maxWidth: {
      default: null,
      [inDocumentBlock()]: `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`,
    },
    marginInline: { default: null, [inDocumentBlock()]: "auto" },
  },
  quote: {
    color: tokens.accent,
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "pointer",
    // Faint curly quotes hug each trace quote so the reader can tell
    // someone's words from a code peek or file link without the link color
    // changing. inline-block keeps the hover underline off the marks.
    "::before": {
      content: "'\\201C'",
      display: "inline-block",
      color: tokens.inkFaint,
    },
    "::after": {
      content: "'\\201D'",
      display: "inline-block",
      color: tokens.inkFaint,
    },
  },
  open: {
    backgroundColor: tokens.linkOpenWash,
  },
  inert: {
    color: tokens.inkFaint,
    textDecoration: "none",
    cursor: "default",
  },
});
