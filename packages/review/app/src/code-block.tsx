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
    // The class scopes the token colors in vendor-overrides.css.
    <figure
      {...withClass(
        className ? `rendered-code-block ${className}` : "rendered-code-block",
        styles.block,
        compact && styles.compact,
      )}
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
                  <span className={`shj-syn-${item.token}`} key={index}>
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

// The same figure as a diagram: hairline frame, tray header with the language
// as its kind, the caption as its title, a line count and an icon-only copy
// button; then the code, scrolling sideways, never wrapping.
const styles = stylex.create({
  block: {
    minWidth: 0,
    maxWidth: {
      default: "100%",
      // A document block sits in the prose column.
      ":is(.review-document .api-document-node > *)": `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`,
    },
    width: {
      default: null,
      ":is(.review-document .api-document-node > *)": `min(100%, ${tokens.reviewProseMaxWidth})`,
    },
    marginInline: {
      default: null,
      ":is(.review-document .api-document-node > *)": "auto",
    },
    marginBlock: "24px",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "8px",
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
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    marginLeft: "auto",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.ruleSoft, ":focus-visible": tokens.accent },
    borderRadius: "6px",
    backgroundColor: {
      default: tokens.surface,
      ":hover": tokens.well,
      ":is([data-copied])": tokens.well,
    },
    color: { default: tokens.inkMuted, ":is([data-copied])": tokens.ink },
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
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
    font: `13px/20px ${tokens.fontMono}`,
    textAlign: "left",
    scrollbarWidth: "thin",
    scrollbarColor: `${tokens.ghost} ${tokens.tray}`,
    "::-webkit-scrollbar": {
      height: "4px",
    },
    "::-webkit-scrollbar-track": {
      backgroundColor: tokens.tray,
    },
    "::-webkit-scrollbar-thumb": {
      borderRadius: "2px",
      backgroundColor: tokens.ghost,
    },
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
