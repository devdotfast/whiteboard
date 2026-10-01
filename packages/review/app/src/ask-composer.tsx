import {
  type AskCommand,
  type AskQuestion,
  type AskUsage,
  askImageTypes,
} from "@review/ask/thread-state";
import { fuzzyRank } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  AskArrowIcon,
  AskCrossIcon,
  AskImageIcon,
  askIconSizes,
} from "./ask-icons";
import { fontSize, layer, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { surfaceStyles } from "./ui/surface";

type ImageType = (typeof askImageTypes)[number];

interface Attached {
  id: string;
  name: string;
  mimeType: ImageType;
  /** Base64, as ACP sends it. */
  data: string;
}

const IMAGES_MAX = 4;

const IMAGE_BYTES_MAX = 5 * 1024 * 1024;

const FIND_DELAY_MS = 80;

const isImageType = (type: string): type is ImageType =>
  askImageTypes.some((allowed) => allowed === type);

/** A file read as base64. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const url = String(reader.result);

      resolve(url.slice(url.indexOf(",") + 1));
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** What the caret is completing: a slash command at the start of the
 * question, or a file after an @. */
type Completion =
  | { kind: "command"; query: string }
  | { kind: "file"; query: string; start: number; end: number };

function completionAt(draft: string, caret: number): Completion | null {
  const command = /^\/(\S*)$/.exec(draft);

  if (command) return { kind: "command", query: command[1]! };

  const before = draft.slice(0, caret);
  const file = /(?:^|\s)@([^\s@]*)$/.exec(before);

  if (!file) return null;

  return {
    kind: "file",
    query: file[1]!,
    start: caret - file[1]!.length - 1,
    end: caret,
  };
}

/**
 * The first of the placeholders, longest first, that keeps the empty question
 * on one line; the last when none does. The question grows to fit its
 * placeholder, so one that wraps would make it two lines tall.
 */
function useFittingPlaceholder(
  input: RefObject<HTMLTextAreaElement | null>,
  placeholders: readonly string[],
  empty: boolean,
): string {
  const key = placeholders.join("\n");
  const [fitting, setFitting] = useState(0);

  useLayoutEffect(() => {
    const question = input.current;
    const row = question?.parentElement;

    if (!question || !row || !empty) return;
    const candidates = key.split("\n");

    const measure = () => {
      const line = parseFloat(getComputedStyle(question).lineHeight);

      const fits = candidates.findIndex((candidate) => {
        question.placeholder = candidate;

        return question.offsetHeight <= line + 1;
      });

      const chosen = fits === -1 ? candidates.length - 1 : fits;

      question.placeholder = candidates[chosen]!;
      setFitting(chosen);
    };

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(row);
    let live = true;

    // The serif may load after the first measure, at a different width.
    if ("fonts" in document)
      void document.fonts.ready.then(() => live && measure());

    return () => {
      live = false;
      observer.disconnect();
    };
  }, [input, key, empty]);

  return placeholders[Math.min(fitting, placeholders.length - 1)]!;
}

/** The checkout's files matching a query, asked for as the reviewer types. */
function useFiles(
  completion: Completion | null,
  findFiles: (query: string, signal: AbortSignal) => Promise<string[]>,
) {
  const [found, setFound] = useState<{ query: string; paths: string[] }>();
  const query = completion?.kind === "file" ? completion.query : null;

  useEffect(() => {
    if (query === null) return;
    const abort = new AbortController();

    const timer = setTimeout(() => {
      findFiles(query, abort.signal)
        .then((paths) => setFound({ query, paths }))
        // Without them the @ is just text.
        .catch(() => {});
    }, FIND_DELAY_MS);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, findFiles]);

  // The last answer stands until the next arrives, so the list does not
  // flicker while typing.
  return query === null ? [] : (found?.paths ?? []);
}

/**
 * Where a question is written: `/` lists the agent's commands, `@` finds a
 * file in the checkout, and an agent that reads images takes pasted,
 * dropped or attached ones.
 */
export function AskComposer({
  inputRef,
  placeholders,
  disabled,
  canAsk,
  stop,
  status,
  commands,
  acceptsImages,
  usage,
  findFiles,
  permissions,
  settings,
  onAsk,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Longest first: the first that fits on one line shows. */
  placeholders: readonly string[];
  disabled: boolean;
  /** Whether a question can go now: an agent is chosen and none is busy. */
  canAsk: boolean;
  /** Stops the turn under way; a Stop button replaces Ask while set. */
  stop?: () => void;
  status: ReactNode;
  commands: AskCommand[] | undefined;
  acceptsImages: boolean;
  usage: AskUsage | undefined;
  findFiles: (query: string, signal: AbortSignal) => Promise<string[]>;
  /** What the agent may do, starting the row below. */
  permissions?: ReactNode;
  /** The agent's model and effort, ending the row below. */
  settings?: ReactNode;
  /** Resolves true once the question is sent, to clear it. */
  onAsk: (question: AskQuestion) => Promise<boolean>;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<string[]>([]);
  const [images, setImages] = useState<Attached[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // Escape hides the list until the question changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const listId = useId();

  const placeholder = useFittingPlaceholder(
    inputRef,
    placeholders,
    draft === "",
  );

  const completion = dismissed === draft ? null : completionAt(draft, caret);
  const paths = useFiles(completion, findFiles);

  const options: { key: string; label: string; detail?: string }[] =
    completion?.kind === "command"
      ? fuzzyRank(completion.query, commands ?? [], (command) => [
          command.name,
        ]).map((command) => ({
          key: command.name,
          label: `/${command.name}`,
          detail: command.hint
            ? `${command.description} · ${command.hint}`
            : command.description,
        }))
      : completion?.kind === "file"
        ? paths.map((path) => {
            const slash = path.lastIndexOf("/");

            // The name first: a deep path would otherwise show only its
            // folders.
            return slash === -1
              ? { key: path, label: path }
              : {
                  key: path,
                  label: path.slice(slash + 1),
                  detail: path.slice(0, slash),
                };
          })
        : [];

  const open = options.length > 0;
  const shown = Math.min(active, options.length - 1);

  useEffect(() => setActive(0), [completion?.kind, completion?.query]);

  const place = (text: string, at: number) => {
    setDraft(text);
    setCaret(at);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
    });
  };

  const pick = (index: number) => {
    const option = options[index];

    if (!option || !completion) return;

    if (completion.kind === "command") {
      const text = `${option.label} `;

      place(text, text.length);

      return;
    }

    const inserted = `@${option.key} `;

    place(
      draft.slice(0, completion.start) + inserted + draft.slice(completion.end),
      completion.start + inserted.length,
    );
    setMentions((current) =>
      current.includes(option.key) ? current : [...current, option.key],
    );
  };

  const attach = async (files: File[]) => {
    const wanted = files.flatMap((file) => {
      const { type } = file;

      return isImageType(type) ? [{ file, mimeType: type }] : [];
    });

    if (!wanted.length) return;
    const room = IMAGES_MAX - images.length;
    const fitting = wanted.filter(({ file }) => file.size <= IMAGE_BYTES_MAX);

    setNote(
      fitting.length < wanted.length
        ? "Images over 5 MB were left out."
        : wanted.length > room
          ? `A question takes up to ${IMAGES_MAX} images.`
          : null,
    );

    const read = await Promise.all(
      fitting.slice(0, Math.max(room, 0)).map(async ({ file, mimeType }) => ({
        id: crypto.randomUUID(),
        name: file.name || "Pasted image",
        mimeType,
        data: await readImage(file),
      })),
    );

    setImages((current) => [...current, ...read].slice(0, IMAGES_MAX));
  };

  const submit = async () => {
    const text = draft.trim();

    if (!text || !canAsk) return;

    // A file stays mentioned while its @ does.
    const mentioned = mentions.filter((path) => draft.includes(`@${path}`));

    const question: AskQuestion = { text };

    if (mentioned.length) question.mentions = mentioned;

    if (images.length)
      question.images = images.map(({ name, mimeType, data }) => ({
        name,
        mimeType,
        data,
      }));

    const sent = await onAsk(question);

    if (!sent) return;
    setDraft("");
    setCaret(0);
    setMentions([]);
    setImages([]);
    setNote(null);
  };

  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;

        setActive((shown + step + options.length) % options.length);

        return;
      }

      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        pick(shown);

        return;
      }

      if (event.key === "Escape") {
        // Escape closes the list, not the panel behind it.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(draft);

        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!acceptsImages) return;

    const files = [...event.clipboardData.files].filter((file) =>
      isImageType(file.type),
    );

    if (!files.length) return;
    event.preventDefault();
    void attach(files);
  };

  const dragOver = (event: DragEvent) => {
    if (acceptsImages && event.dataTransfer.types.includes("Files"))
      event.preventDefault();
  };

  const drop = (event: DragEvent) => {
    if (!acceptsImages) return;
    event.preventDefault();
    void attach([...event.dataTransfer.files]);
  };

  const share = usage && usage.size > 0 ? usage.used / usage.size : undefined;

  return (
    <div {...stylex.props(styles.dock)}>
      <form
        {...stylex.props(styles.composer)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragOver={dragOver}
        onDrop={drop}
      >
        {open ? (
          <div
            id={listId}
            role="listbox"
            aria-label={completion?.kind === "command" ? "Commands" : "Files"}
            {...stylex.props(surfaceStyles.popover, styles.list)}
          >
            {options.map((option, index) => (
              <div
                key={option.key}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === shown}
                {...stylex.props(
                  styles.option,
                  index === shown && styles.optionActive,
                )}
                // Picking keeps the question focused.
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => pick(index)}
              >
                <span {...stylex.props(styles.optionLabel)}>
                  {option.label}
                </span>
                {option.detail ? (
                  <span {...stylex.props(styles.optionDetail)}>
                    {option.detail}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {images.length ? (
          <ul {...stylex.props(styles.images)} aria-label="Attached images">
            {images.map((image) => (
              <li key={image.id} {...stylex.props(styles.image)}>
                <img
                  {...stylex.props(styles.thumbnail)}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name}
                />
                <button
                  type="button"
                  {...stylex.props(styles.remove)}
                  aria-label={`Remove ${image.name}`}
                  title={`Remove ${image.name}`}
                  onClick={() =>
                    setImages((current) =>
                      current.filter((other) => other.id !== image.id),
                    )
                  }
                >
                  <AskCrossIcon xstyle={askIconSizes.small} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div {...stylex.props(styles.inputRow)}>
          <textarea
            ref={inputRef}
            {...stylex.props(styles.question)}
            value={draft}
            rows={1}
            placeholder={placeholder}
            aria-label="Question"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${shown}` : undefined}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              setCaret(event.target.selectionStart);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={keydown}
            onPaste={paste}
          />
          <span {...stylex.props(styles.actions)}>
            {acceptsImages ? (
              <>
                <input
                  ref={picker}
                  type="file"
                  accept={askImageTypes.join(",")}
                  multiple
                  hidden
                  onChange={(event) => {
                    void attach([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  {...stylex.props(styles.attach)}
                  aria-label="Attach images"
                  title="Attach images"
                  disabled={disabled || images.length >= IMAGES_MAX}
                  onClick={() => picker.current?.click()}
                >
                  <AskImageIcon xstyle={askIconSizes.toolbar} />
                </button>
              </>
            ) : null}
            {stop ? (
              <button
                type="button"
                {...stylex.props(styles.send, styles.stop)}
                onClick={stop}
              >
                <span aria-hidden="true" {...stylex.props(styles.stopMark)} />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                {...stylex.props(styles.send, styles.submit)}
                disabled={!draft.trim() || !canAsk}
              >
                Ask
                <AskArrowIcon
                  xstyle={[askIconSizes.small, styles.submitIcon]}
                />
              </button>
            )}
          </span>
        </div>
      </form>
      {/* The status sits between the settings, so it comes and goes without
          moving anything. */}
      <div {...stylex.props(styles.settings)}>
        {permissions}
        <span {...stylex.props(styles.status)}>{note ?? status}</span>
        {share === undefined ? null : (
          <span
            {...stylex.props(styles.usage)}
            title={`${usage!.used.toLocaleString()} of ${usage!.size.toLocaleString()} tokens of context used`}
          >
            {Math.round(share * 100)}% context
            {usage!.cost
              ? ` · ${new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: usage!.cost.currency,
                  maximumFractionDigits: 2,
                }).format(usage!.cost.amount)}`
              : null}
          </span>
        )}
        {settings}
      </div>
    </div>
  );
}

const noBorder = {
  borderWidth: 0,
  borderStyle: "none",
} as const;

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

const styles = stylex.create({
  dock: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    gap: "6px",
    margin: "12px 16px 12px",
  },
  composer: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "12px 12px 10px 14px",
    ...hairline,
    borderColor: {
      default: tokens.ruleSoft,
      ":focus-within": tokens.accentOutline,
    },
    borderRadius: radius.surface,
    backgroundColor: tokens.raised,
  },
  // Quiet, like the agent's own controls under its prompt.
  settings: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    minWidth: 0,
    paddingInline: "2px",
  },
  // Opens upward, over the thread.
  list: {
    position: "absolute",
    right: 0,
    bottom: "calc(100% + 6px)",
    left: 0,
    zIndex: layer.popover,
    display: "flex",
    flexDirection: "column",
    maxHeight: "min(280px, 40vh)",
    padding: "4px",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  option: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "6px 10px",
    borderRadius: radius.small,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    cursor: "pointer",
  },
  optionActive: {
    backgroundColor: tokens.accentWash,
  },
  optionLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  optionDetail: {
    overflow: "hidden",
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: "14px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  images: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  image: {
    position: "relative",
    width: "48px",
    height: "48px",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    ...hairline,
    borderColor: tokens.ruleSoft,
    borderRadius: radius.small,
    objectFit: "cover",
  },
  remove: {
    position: "absolute",
    top: "-6px",
    right: "-6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    padding: 0,
    ...hairline,
    borderColor: tokens.ruleSoft,
    borderRadius: radius.round,
    backgroundColor: tokens.surfaceRaised,
    color: tokens.inkMuted,
    cursor: "pointer",
  },
  question: {
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: "22px",
    maxHeight: "160px",
    padding: 0,
    ...noBorder,
    resize: "none",
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "22px",
    fieldSizing: "content",
    outline: { default: null, ":focus": "none" },
    "::placeholder": {
      color: tokens.inkFaint,
    },
  },
  // The question, with its buttons beside it.
  inputRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
  },
  // Fills the row between the settings, pushing the model and effort to its
  // end.
  status: {
    flex: "1 1 0",
    minWidth: 0,
    paddingInline: "6px",
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: "16px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: "8px",
  },
  usage: {
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: "16px",
    whiteSpace: "nowrap",
  },
  attach: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px",
    ...noBorder,
    borderRadius: radius.small,
    backgroundColor: {
      default: tokens.transparent,
      ":not(:disabled):hover": tokens.accentWash,
    },
    color: tokens.inkMuted,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.45 },
  },
  send: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    ...hairline,
    borderRadius: radius.surface,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
  submit: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
    opacity: { default: null, ":disabled": 0.45 },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  submitIcon: {
    strokeWidth: "1.4px",
  },
  stop: {
    paddingLeft: "8px",
    borderColor: tokens.ruleSoft,
    backgroundColor: tokens.transparent,
    color: tokens.ink,
  },
  stopMark: {
    width: "8px",
    height: "8px",
    borderRadius: radius.hairline,
    backgroundColor: "currentColor",
  },
});
