import { space } from "@canvas/scale.stylex";
import type {
  ReviewFindQuery,
  ReviewInlineEditorHandle,
  ReviewInlineEditorSpec,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { CodeText, codeLanguage } from "./code-block";
import { DiagramHeader } from "./diagram-header";
import { tokens } from "./tokens.stylex";
import type { CreateSourceViewer, SourceRequest } from "./web-entry-api";

interface Excerpt {
  firstLine: number;
  code: string;
}

/**
 * A read-only inline editor for hosts without Monaco: the quoted lines,
 * highlighted, under the file's header. It finds by counting matches.
 */
export const createSourceViewer: CreateSourceViewer = ({ readSource }) => {
  const excerpts = async (request: SourceRequest): Promise<Excerpt[]> => {
    const lines = (await readSource(request)).split("\n");

    return request.ranges.map((range) => ({
      firstLine: range.startLine,
      code: lines.slice(range.startLine - 1, range.endLine).join("\n"),
    }));
  };

  return {
    async find(request, query) {
      return { matchCount: countMatches(await excerpts(request), query) };
    },
    create(spec) {
      return mountSourceView(spec, excerpts(spec));
    },
  };
};

function mountSourceView(
  spec: ReviewInlineEditorSpec,
  loading: Promise<Excerpt[]>,
): ReviewInlineEditorHandle {
  const heightListeners = new Set<(height: number) => void>();
  const errorListeners = new Set<(message: string) => void>();
  let failure: string | undefined;
  let loaded: Excerpt[] = [];
  let height = 0;

  loading.then(
    (excerpts) => {
      loaded = excerpts;
    },
    (cause: unknown) => {
      failure = cause instanceof Error ? cause.message : String(cause);
      errorListeners.forEach((listener) => listener(failure!));
    },
  );

  const root = createRoot(spec.container);
  root.render(
    <SourceView
      spec={spec}
      loading={loading}
      onHeight={(next) => {
        height = next;
        heightListeners.forEach((listener) => listener(next));
      }}
    />,
  );

  return {
    get height() {
      return height;
    },
    setActive() {},
    setCollapsed() {},
    onDidChangeHeight(listener) {
      heightListeners.add(listener);

      return { dispose: () => heightListeners.delete(listener) };
    },
    onDidError(listener) {
      errorListeners.add(listener);

      if (failure) listener(failure);

      return { dispose: () => errorListeners.delete(listener) };
    },
    async setFindQuery(query) {
      return { matchCount: countMatches(loaded, query) };
    },
    revealFindMatch() {},
    clearActiveFindMatch() {},
    clearFind() {},
    dispose() {
      heightListeners.clear();
      errorListeners.clear();
      root.unmount();
    },
  };
}

function SourceView({
  spec,
  loading,
  onHeight,
}: {
  spec: ReviewInlineEditorSpec;
  loading: Promise<Excerpt[]>;
  onHeight(height: number): void;
}) {
  const [excerpts, setExcerpts] = useState<Excerpt[]>();
  const frame = useRef<HTMLElement>(null);
  const language = codeLanguage(spec.path.split(".").at(-1) ?? "");

  useEffect(() => {
    let current = true;

    void loading.then(
      (loaded) => current && setExcerpts(loaded),
      () => {},
    );

    return () => {
      current = false;
    };
  }, [loading]);

  useEffect(() => {
    const element = frame.current;

    if (!element) return;
    const observer = new ResizeObserver(() => onHeight(element.offsetHeight));
    observer.observe(element);

    return () => observer.disconnect();
  }, [onHeight]);

  return (
    <figure ref={frame} {...stylex.props(styles.frame)}>
      <DiagramHeader
        kind={language ?? "code"}
        title={spec.title}
        meta={spec.description}
      />
      <div
        {...stylex.props(
          styles.body,
          spec.heightMode === "capped" && styles.capped,
        )}
      >
        {excerpts?.map((excerpt) => (
          <div key={excerpt.firstLine} {...stylex.props(styles.excerpt)}>
            <CodeText
              code={excerpt.code}
              language={language}
              lineNumbers
              firstLine={excerpt.firstLine}
            />
          </div>
        ))}
      </div>
    </figure>
  );
}

function countMatches(excerpts: Excerpt[], query: ReviewFindQuery): number {
  if (!query.text) return 0;

  const source = query.isRegex
    ? query.text
    : query.text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let pattern: RegExp;

  try {
    pattern = new RegExp(
      query.wholeWord ? `\\b(?:${source})\\b` : source,
      query.matchCase ? "g" : "gi",
    );
  } catch {
    return 0;
  }

  return excerpts.reduce(
    (total, excerpt) =>
      total +
      [...excerpt.code.matchAll(pattern)].filter((match) => match[0]).length,
    0,
  );
}

const styles = stylex.create({
  frame: {
    margin: 0,
    backgroundColor: tokens.surface,
  },
  body: {
    overflowY: "auto",
  },
  capped: {
    maxHeight: "18lh",
  },
  excerpt: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.ruleSoft,
    paddingBlock: space.s4,
  },
});
