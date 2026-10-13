import {
  elevation,
  fontSize,
  fontWeight,
  layer,
  radius,
  tracking,
} from "@canvas/scale.stylex";
import type {
  BoardIconKind,
  PullRequestState,
} from "@dev.fast/review-protocol";
import type { BoardLinkPreview } from "@review/review-api/link-preview";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { BoardIcon, PullRequestStateIcon } from "./board-icons";
import { formatRelativeTime } from "./format";
import { useOptionalReviewSession } from "./host/review-session";
import { tokens } from "./tokens.stylex";

/** What a board link points at now. Missing if the board or block was deleted. */
export interface BoardLinkTarget {
  title?: string;
  missing: boolean;
  /** Set when this host recorded the board's deletion. */
  deletedAt?: string;
  /** On a shared board: the board is on the sender's machine, not this one. */
  elsewhere?: boolean;
  icon?: BoardIconKind;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  pullRequestState?: PullRequestState;
  /** "owner / repo", or its repository's folder. */
  repository?: string;
  /** What the hover card shows of the board or block, read when it opens. */
  preview?: BoardLinkPreview;
  updatedAt?: string;
}

function missingLabel(
  target: BoardLinkTarget | undefined,
  blockId: string | undefined,
): string {
  if (target?.elsewhere) return "Not on this machine";

  if (target?.deletedAt) {
    const day = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(target.deletedAt));

    return `Board deleted · ${day}`;
  }

  // The board still exists, so the block was deleted.
  if (target?.title && blockId !== undefined) return "Block deleted";

  return "Board deleted";
}

const PREVIEW_DELAY_MS = 350;

/** Inline board link with a hover preview; deleted targets are struck
 * through. */
export function BoardLink({
  reviewId,
  blockId,
  target,
  children,
}: {
  reviewId: string;
  /** Block to scroll to when the board opens. */
  blockId?: string;
  /** Undefined if unknown, e.g. the links failed to load. Renders as a normal link. */
  target: BoardLinkTarget | undefined;
  children?: ReactNode;
}) {
  const session = useOptionalReviewSession();
  const [previewing, setPreviewing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (target?.missing)
    return (
      <span
        data-unavailable="board"
        title={missingLabel(target, blockId)}
        {...stylex.props(styles.link, styles.missing)}
      >
        <BoardIcon
          icon={target.icon}
          xstyle={[styles.icon, styles.inherit, styles.ghostIcon]}
        />
        {children}
      </span>
    );

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setPreviewing(false);
    void session?.surface.post({
      name: "openReview",
      args: {
        reviewUuid: reviewId,
        active: !(event.metaKey || event.ctrlKey || event.shiftKey),
        ...(blockId !== undefined && { blockId }),
      },
    });
  };

  return (
    <span
      {...stylex.props(styles.anchor)}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setPreviewing(false);
      }}
    >
      <a
        href={`#board-${reviewId}`}
        onClick={open}
        {...stylex.props(styles.link)}
      >
        <BoardIcon icon={target?.icon} xstyle={[styles.icon, styles.inherit]} />
        {children}
      </a>
      {previewing && target?.title ? (
        <Peek target={target} reviewId={reviewId} blockId={blockId} />
      ) : null}
    </span>
  );
}

/** Markdown's inline marks as plain styled text: code, links, emphasis. */
function InlineText({ markdown }: { markdown: string }): ReactNode {
  const parts: ReactNode[] = [];

  const marks =
    /`([^`]+)`|\[([^\]]+)\]\([^)]*\)|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;

  let last = 0;

  for (const match of markdown.matchAll(marks)) {
    parts.push(markdown.slice(last, match.index));
    const [, code, link, strong, em, underscored] = match;

    parts.push(
      code !== undefined ? (
        <code key={match.index} {...stylex.props(styles.code)}>
          {code}
        </code>
      ) : link !== undefined ? (
        <span key={match.index} {...stylex.props(styles.linkText)}>
          {link}
        </span>
      ) : strong !== undefined ? (
        <strong key={match.index}>{strong}</strong>
      ) : (
        <em key={match.index}>{em ?? underscored}</em>
      ),
    );
    last = match.index + match[0].length;
  }

  parts.push(markdown.slice(last));

  return parts;
}

/** Paragraphs of a board's prose; list items keep their own lines. */
function Prose({ paragraphs }: { paragraphs: string[] }): ReactNode {
  return paragraphs.map((paragraph, index) => (
    <span key={index} {...stylex.props(styles.paragraph)}>
      {paragraph.split("\n").map((line, row) => {
        const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);

        return (
          <span key={row} {...stylex.props(item && styles.listItem)}>
            {item ? "• " : row ? " " : ""}
            <InlineText markdown={item ? item[1] : line.trim()} />
          </span>
        );
      })}
    </span>
  ));
}

/** A PR's state the board's links did not have yet, read again until the
 * host has it. The card shows the faint icon meanwhile, never waiting. */
function useLateState(target: BoardLinkTarget): PullRequestState | undefined {
  const session = useOptionalReviewSession();

  const missing = Boolean(
    session && target.pullRequestUrl && !target.pullRequestState,
  );

  const unread = (links: LinkStates | undefined) =>
    !links?.outgoing.some(
      (link) =>
        link.pullRequestUrl === target.pullRequestUrl && link.pullRequestState,
    );

  const { data } = useQuery({
    queryKey: ["board-link-pull-request-states"],
    enabled: missing,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<LinkStates> =>
      // SAFETY: /links returns its outgoing links with these fields.
      (await (await session!.fetch("/links")).json()) as LinkStates,
    refetchInterval: (query) =>
      query.state.dataUpdateCount < 5 && unread(query.state.data)
        ? 2000
        : false,
  });

  return data?.outgoing.find(
    (link) => link.pullRequestUrl === target.pullRequestUrl,
  )?.pullRequestState;
}

interface LinkStates {
  outgoing: { pullRequestUrl?: string; pullRequestState?: PullRequestState }[];
}

/** The card's right corner: a PR's state. */
function Badge({
  target,
  number,
}: {
  target: BoardLinkTarget;
  number: number;
}): ReactNode {
  const late = useLateState(target);

  return (
    <PullRequestStateIcon
      number={number}
      state={target.pullRequestState ?? late}
    />
  );
}

// Hover cards read once per link and version of the board they are on.
const peeks = new Map<string, Promise<BoardLinkPreview>>();

/** The hover card, which reads what it shows of the target when it opens:
 * a board's links carry only titles and icons. */
function Peek({
  target,
  reviewId,
  blockId,
}: {
  target: BoardLinkTarget;
  reviewId: string;
  blockId?: string;
}): ReactNode {
  const session = useOptionalReviewSession();
  const [preview, setPreview] = useState(target.preview);

  useEffect(() => {
    if (!session || target.preview) return;

    const endpoint = `/links/peek?${new URLSearchParams({
      board: reviewId,
      ...(blockId !== undefined && { block: blockId }),
    })}` as const;

    const key = session.apiUrl(endpoint);
    let read = peeks.get(key);

    if (!read) {
      read = session.fetch(endpoint).then(async (response) => {
        if (!response.ok) throw new Error("No preview");

        // SAFETY: /links/peek answers with the card's preview.
        return (await response.json()) as BoardLinkPreview;
      });
      read.catch(() => peeks.delete(key));
      peeks.set(key, read);
    }

    let live = true;

    // A card that can't read its preview shows the title alone.
    read.then((next) => live && setPreview(next)).catch(() => {});

    return () => {
      live = false;
    };
  }, [session, target.preview, reviewId, blockId]);

  const shown = { ...target, preview };

  return blockId === undefined ? (
    <PagePeek target={shown} />
  ) : (
    <BlockPeek target={shown} />
  );
}

/** A link to a board: its title and opening prose, fading out. */
function PagePeek({ target }: { target: BoardLinkTarget }): ReactNode {
  const prose = target.preview?.prose ?? [];

  return (
    <span role="tooltip" {...stylex.props(styles.card)}>
      <span {...stylex.props(styles.top)}>
        <BoardIcon icon={target.icon} xstyle={styles.kind} />
        {target.repository ? (
          <span {...stylex.props(styles.repository)}>{target.repository}</span>
        ) : null}
        <span {...stylex.props(styles.spacer)} />
        {target.pullRequestNumber ? (
          <Badge target={target} number={target.pullRequestNumber} />
        ) : null}
      </span>
      <span {...stylex.props(styles.title)}>{target.title}</span>
      {prose.length ? (
        <span {...stylex.props(styles.clip)}>
          <Prose paragraphs={prose} />
        </span>
      ) : null}
      {target.updatedAt ? (
        <span {...stylex.props(styles.footer)}>
          Updated {formatRelativeTime(target.updatedAt)}
        </span>
      ) : null}
    </span>
  );
}

/** A link to a block: where it is, then the block under a marker bar. */
function BlockPeek({ target }: { target: BoardLinkTarget }): ReactNode {
  const preview = target.preview ?? {};

  return (
    <span role="tooltip" {...stylex.props(styles.card)}>
      <span {...stylex.props(styles.top)}>
        <BoardIcon icon={target.icon} xstyle={styles.kind} />
        <span {...stylex.props(styles.crumb)}>{target.title}</span>
        {preview.section ? (
          <>
            <svg
              aria-hidden="true"
              width="10"
              height="10"
              viewBox="0 0 10 10"
              {...stylex.props(styles.chevron)}
            >
              <path d="M3.5 2 L6.5 5 L3.5 8" />
            </svg>
            <span {...stylex.props(styles.crumb)}>{preview.section}</span>
          </>
        ) : null}
        <span {...stylex.props(styles.spacer)} />
        {target.pullRequestNumber ? (
          <Badge target={target} number={target.pullRequestNumber} />
        ) : null}
      </span>
      <span {...stylex.props(styles.quote)}>
        <span {...stylex.props(styles.bar)} />
        {preview.code ? (
          <span {...stylex.props(styles.codeCrop)}>
            {preview.code.lines.join("\n")}
          </span>
        ) : preview.figure ? (
          <span {...stylex.props(styles.figure)}>
            <span {...stylex.props(styles.badge)}>
              {preview.figure.type.replaceAll("_", " ")}
            </span>
            <span {...stylex.props(styles.figureTitle)}>
              {preview.figure.title}
            </span>
          </span>
        ) : (
          <span {...stylex.props(styles.clip)}>
            <Prose paragraphs={preview.prose ?? []} />
          </span>
        )}
      </span>
    </span>
  );
}

const styles = stylex.create({
  anchor: { position: "relative" },
  link: {
    display: "inline",
    color: tokens.accent,
    textDecoration: "none",
    cursor: "pointer",
  },
  missing: {
    color: tokens.inkFaint,
    textDecoration: "line-through",
    cursor: "default",
  },
  ghostIcon: { opacity: 0.45 },
  // The link's own colour.
  inherit: { color: "inherit" },
  icon: {
    display: "inline-block",
    width: fontSize.reading,
    height: fontSize.reading,
    marginRight: "2px",
    verticalAlign: "-2px",
  },
  card: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    zIndex: layer.popover,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    width: "410px",
    paddingTop: "16px",
    paddingBottom: "14px",
    paddingInline: "18px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    boxShadow: elevation.popover,
    color: tokens.ink,
    fontStyle: "normal",
    fontWeight: fontWeight.regular,
    textAlign: "left",
    textIndent: 0,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  top: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  kind: { color: tokens.inkMuted },
  repository: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  spacer: { flex: "1 1 0" },
  badge: {
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: "14px",
    textTransform: "uppercase",
  },
  // A board's title is Newsreader only as its own page's heading.
  title: {
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.headline,
    fontWeight: fontWeight.medium,
    letterSpacing: tracking.tight,
    lineHeight: "26px",
  },
  // About 180px of prose, fading into the card.
  clip: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxHeight: "180px",
    overflow: "hidden",
    maskImage: "linear-gradient(to bottom, black 130px, transparent 180px)",
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "23px",
  },
  paragraph: { display: "block" },
  listItem: { display: "block" },
  code: {
    fontFamily: tokens.fontMono,
    fontSize: fontSize.ui,
  },
  linkText: { color: tokens.accent },
  footer: {
    paddingTop: "6px",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  crumb: {
    overflow: "hidden",
    minWidth: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: {
    flexShrink: 0,
    fill: "none",
    stroke: tokens.inkFaint,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.2,
  },
  quote: { display: "flex", gap: "12px", minWidth: 0 },
  bar: {
    flexShrink: 0,
    width: "2px",
    borderRadius: radius.hairline,
    backgroundColor: tokens.accent,
  },
  codeCrop: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "18px",
    whiteSpace: "pre",
  },
  figure: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  figureTitle: {
    overflow: "hidden",
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
