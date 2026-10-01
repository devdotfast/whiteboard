import { type AskFileRef, parseFileRef } from "@review/ask/file-refs";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { useReviewSession } from "./host/review-session";
import { radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const resolvedSchema = z.object({
  files: z.array(z.object({ path: z.string(), file: z.string() })),
});

/** The server resolves at most this many paths per request. */
const BATCH = 100;

interface AskFiles {
  /** The checkout file a path names: null for none, undefined until known. */
  lookup(path: string): string | null | undefined;
  /** Asks the server which file a path names, once per path. */
  request(path: string): void;
  open(file: string, line?: number): void;
}

const AskFilesContext = createContext<AskFiles | null>(null);

/** Resolves the files a conversation's answers name. Key it by the thread:
 * what one thread's checkout holds says nothing of another's. */
export function AskFilesProvider({
  threadId,
  children,
}: {
  threadId: string | null;
  children: ReactNode;
}): ReactElement {
  const session = useReviewSession();
  const [known, setKnown] = useState(() => new Map<string, string | null>());
  const asked = useRef(new Set<string>());
  const queued = useRef<string[]>([]);
  const flushing = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
    };
  }, []);

  const files = useMemo<AskFiles>(() => {
    const flush = async () => {
      while (queued.current.length) {
        const paths = queued.current.splice(0, BATCH);
        const found = new Map<string, string | null>();

        try {
          const response = await session.fetch(`/ask/${threadId}/files`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ paths }),
          });

          if (response.ok)
            for (const { path, file } of resolvedSchema.parse(
              await response.json(),
            ).files)
              found.set(path, file);
        } catch {
          /* Unresolved paths stay code. */
        }

        if (!live.current) return;
        setKnown((current) => {
          const next = new Map(current);

          for (const path of paths) next.set(path, found.get(path) ?? null);

          return next;
        });
      }

      flushing.current = false;
    };

    return {
      lookup: (path) => known.get(path),
      request: (path) => {
        if (!threadId || asked.current.has(path)) return;
        asked.current.add(path);
        queued.current.push(path);

        if (flushing.current) return;
        flushing.current = true;
        // Paths rendered together go in one request.
        queueMicrotask(() => void flush());
      },
      open: (file, line) =>
        void session.surface
          .post({
            name: "reveal",
            args: {
              path: file,
              startLine: line ?? 1,
              endLine: line ?? 1,
              side: "head",
              highlight: line !== undefined,
              preserveFocus: false,
            },
          })
          .catch(() => {}),
    };
  }, [known, session, threadId]);

  return (
    <AskFilesContext.Provider value={files}>
      {children}
    </AskFilesContext.Provider>
  );
}

/** A file the answer names: a link that opens it in the Source window once
 * the checkout confirms the file, else what the answer wrote. */
function AskFileLink({
  fileRef,
  fallback,
  children,
}: {
  fileRef: AskFileRef;
  fallback: ReactNode;
  children: ReactNode;
}): ReactNode {
  const files = useContext(AskFilesContext);
  const { path, line } = fileRef;

  useEffect(() => files?.request(path), [files, path]);
  const file = files?.lookup(path);

  if (!files || !file) return fallback;
  const open = () => files.open(file, line);

  // A link, not a button: a button is one box, so a long path would jump to
  // its own line instead of wrapping with the sentence around it. It has no
  // href, since the file opens in the Source window, not a page.
  return (
    <a
      role="link"
      tabIndex={0}
      {...stylex.props(styles.link)}
      title={`Open ${file}${line ? `:${line}` : ""}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        open();
      }}
    >
      {children}
    </a>
  );
}

/** Inline code that names a file, as Codex writes them: `src/app.ts:42`.
 * As a link it takes the link's color, so it does not pass for plain code. */
export function askFileCode(
  value: string,
  code: (xstyle?: stylex.StyleXStyles) => ReactElement,
): ReactNode {
  const fileRef = parseFileRef(value);

  if (!fileRef) return undefined;

  return (
    <AskFileLink fileRef={fileRef} fallback={code()}>
      {code(styles.code)}
    </AskFileLink>
  );
}

/** A link to a file: `[app.ts](src/app.ts#L42)`. Links elsewhere keep the
 * default handling. */
export function askFileLink(href: string, children: ReactNode): ReactNode {
  const fileRef = parseFileRef(href);

  if (!fileRef) return undefined;

  return (
    <AskFileLink fileRef={fileRef} fallback={<span>{children}</span>}>
      {children}
    </AskFileLink>
  );
}

const styles = stylex.create({
  code: {
    color: "inherit",
  },
  // A file the answer names, which opens in the Source window.
  link: {
    color: tokens.accent,
    textDecorationLine: "underline",
    textDecorationColor: {
      default: tokens.accentOutline,
      ":hover": "currentColor",
    },
    textDecorationThickness: "1px",
    textUnderlineOffset: "3px",
    cursor: "pointer",
    borderRadius: { default: null, ":focus-visible": radius.small },
    outline: {
      default: null,
      ":focus-visible": `2px solid ${tokens.accentOutline}`,
    },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
});
