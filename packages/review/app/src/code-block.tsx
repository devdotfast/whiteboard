import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import {
  type ShjLanguage,
  type ShjToken,
  tokenize,
} from "@speed-highlight/core";
import * as stylex from "@stylexjs/stylex";
import {
  type ComponentProps,
  type ReactElement,
  useEffect,
  useState,
} from "react";

import { CopyButton } from "./copy-text";
import { DiagramHeader } from "./diagram-header";
import { drawStyles } from "./draw-styles";
import { documentMarker } from "./markers.stylex";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

export interface RenderedCodeBlockProps extends ComponentProps<"pre"> {
  code: string;
  language?: string | null;
  /** Header title; a fenced markdown block has none. */
  caption?: string;
  /** Ghost line numbers in a sticky gutter; off for fenced markdown. */
  lineNumbers?: boolean;
  /** Tighter block margins, for a chat message. */
  compact?: boolean;
  codeAttributes?: Record<string, string>;
}

/** A code figure: the same header as the other figures (language badge,
 * caption, line count, copy), then the highlighted code. */
export function RenderedCodeBlock({
  code,
  language,
  caption,
  lineNumbers = false,
  compact = false,
  codeAttributes,
  className,
  ...props
}: RenderedCodeBlockProps): ReactElement {
  const normalizedLanguage = normalizeMarkdownCodeLanguage(language ?? "");

  const [highlightedTokens, setHighlightedTokens] = useState<
    HighlightedToken[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    if (!normalizedLanguage) {
      setHighlightedTokens(null);

      return;
    }

    const tokens: HighlightedToken[] = [];
    tokenize(code, normalizedLanguage, (text, token) => {
      tokens.push({ text, token });
    })
      .then(() => {
        if (!cancelled) setHighlightedTokens(tokens);
      })
      .catch(() => {
        if (!cancelled) setHighlightedTokens(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, normalizedLanguage]);

  const displayLanguage = normalizedLanguage ?? language?.trim() ?? undefined;
  const lineCount = countLines(code);

  return (
    <figure
      {...(className
        ? withClass(
            className,
            styles.block,
            compact && styles.compact,
            drawStyles.blockChild,
          )
        : stylex.props(
            styles.block,
            compact && styles.compact,
            drawStyles.blockChild,
          ))}
      data-language={displayLanguage}
    >
      <DiagramHeader
        kind={displayLanguage || "code"}
        title={caption}
        meta={`${lineCount} ${lineCount === 1 ? "line" : "lines"}`}
        xstyle={styles.header}
        metaStyle={styles.meta}
        action={
          <CopyButton
            text={code}
            label="Copy"
            xstyle={styles.copy}
            iconStyle={styles.copyIcon}
          />
        }
      />
      <pre {...props} {...stylex.props(styles.body)}>
        {lineNumbers && (
          <span aria-hidden="true" {...stylex.props(styles.gutter)}>
            {Array.from({ length: lineCount }, (_, index) => index + 1).join(
              "\n",
            )}
          </span>
        )}
        <code
          {...codeAttributes}
          {...stylex.props(styles.code)}
          data-review-copy-prose
        >
          {normalizedLanguage && highlightedTokens
            ? highlightedTokens.map((item, index) =>
                item.token ? (
                  <span
                    {...stylex.props(syntaxByToken.get(item.token))}
                    key={index}
                  >
                    {item.text}
                  </span>
                ) : (
                  item.text
                ),
              )
            : code}
        </code>
      </pre>
    </figure>
  );
}

/** A trailing newline ends the last line rather than starting an empty one. */
function countLines(code: string): number {
  const lines = code.split("\n");

  return lines.length > 1 && lines.at(-1) === ""
    ? lines.length - 1
    : lines.length;
}

interface HighlightedToken {
  text: string;
  token: ShjToken | undefined;
}

function normalizeMarkdownCodeLanguage(language: string): ShjLanguage | null {
  const normalized = language.trim().toLowerCase();

  switch (normalized) {
    case "asm":
    case "bash":
    case "bf":
    case "c":
    case "css":
    case "csv":
    case "diff":
    case "docker":
    case "git":
    case "go":
    case "html":
    case "http":
    case "ini":
    case "java":
    case "js":
    case "jsdoc":
    case "json":
    case "leanpub-md":
    case "log":
    case "lua":
    case "make":
    case "md":
    case "pl":
    case "plain":
    case "py":
    case "regex":
    case "rs":
    case "sql":
    case "todo":
    case "toml":
    case "ts":
    case "uri":
    case "xml":
    case "yaml":
      return normalized;
    case "javascript":
    case "jsx":
      return "js";
    case "typescript":
    case "tsx":
      return "ts";
    case "python":
      return "py";
    case "rust":
      return "rs";
    case "markdown":
    case "mdx":
      return "md";
    case "shell":
    case "sh":
    case "zsh":
      return "bash";
    case "yml":
      return "yaml";
    case "text":
      return "plain";
    default:
      return null;
  }
}

const inDocument = () => stylex.when.ancestor(":is(*)", documentMarker);

// A block's own element: a child of the block's node.
const inDocumentBlock = () => `${inDocument()}:is([data-review-node-id] > *)`;

// The same figure as a diagram: hairline frame, tray header with the language
// as its kind, the caption as its title, a line count and an icon-only copy
// button; then the code, scrolling sideways, never wrapping.
const styles = stylex.create({
  block: {
    minWidth: 0,
    maxWidth: {
      default: "100%",
      // A document block sits in the prose column.
      [inDocumentBlock()]: `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`,
    },
    width: {
      default: null,
      [inDocumentBlock()]: `min(100%, ${tokens.reviewProseMaxWidth})`,
    },
    marginInline: {
      default: null,
      [inDocumentBlock()]: "auto",
    },
    marginBlock: "24px",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
  },
  compact: {
    marginBlock: "8px",
  },
  header: {
    paddingRight: "8px",
  },
  meta: {
    marginLeft: 0,
  },
  copy: {
    marginLeft: "auto",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    backgroundColor: {
      default: tokens.surface,
      ":hover": tokens.well,
      ":is([data-copied])": tokens.well,
    },
  },
  copyIcon: {
    width: "14px",
    height: "14px",
    strokeWidth: "1.5px",
  },
  body: {
    display: "flex",
    margin: 0,
    overflowX: "auto",
    color: tokens.ink,
    font: `${fontSize.ui}/20px ${tokens.fontMono}`,
    textAlign: "left",
  },
  code: {
    display: "block",
    flex: "1 0 auto",
    padding: "12px 14px",
    borderRadius: 0,
    backgroundColor: tokens.transparent,
    color: "inherit",
    font: "inherit",
    whiteSpace: "pre",
    // As the editor shows tabs; the browser's eight push indented code
    // off the block.
    tabSize: 4,
  },
  gutter: {
    position: "sticky",
    left: 0,
    flex: "0 0 auto",
    minWidth: "50px",
    padding: "12px 14px",
    backgroundColor: tokens.surface,
    color: tokens.ghost,
    textAlign: "right",
    whiteSpace: "pre",
    userSelect: "none",
  },
});

// Syntax tokens (@speed-highlight/core). The Whiteboard palette: ink at three
// strengths, the marker for keywords, two more blues for types and functions,
// one warm pencil for strings and one plum for numbers. Comments are quiet and
// italic. Diff green and red are reserved for the diff language. The editor
// themes carry the same values.
const syntaxStyles = stylex.create({
  kwd: { color: tokens.accent },
  type: { color: tokens.syntaxType },
  class: { color: tokens.syntaxType, fontWeight: fontWeight.medium },
  func: { color: tokens.syntaxFunction },
  section: { color: tokens.syntaxFunction, fontWeight: fontWeight.semibold },
  var: { color: tokens.ink },
  str: { color: tokens.syntaxString },
  num: { color: tokens.syntaxNumber },
  bool: { color: tokens.syntaxNumber, fontWeight: fontWeight.medium },
  cmnt: { color: tokens.syntaxComment, fontStyle: "italic" },
  oper: { color: tokens.syntaxOperator },
  insert: { color: tokens.syntaxInserted },
  deleted: { color: tokens.syntaxDeleted },
  err: {
    color: tokens.syntaxDeleted,
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
  },
});

const syntaxByToken = new Map<string, stylex.StyleXStyles>(
  Object.entries(syntaxStyles),
);
