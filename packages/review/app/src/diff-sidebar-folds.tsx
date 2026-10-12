import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { z } from "zod";

import { useReviewSession } from "./host/review-session";
import type { ReviewTocEntry } from "./review-document-headings";
import { fontSize, fontWeight, tracking } from "./scale.stylex";
import {
  ContentsList,
  type ProjectBoards,
  WhiteboardsList,
} from "./sidebar-sections";
import { tokens } from "./tokens.stylex";

const projectSchema = z.object({
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  // SAFETY: catalog summaries, as the server lists them.
  boards: z.array(z.custom<ReviewApiSummary>()),
});

/** The document's headings, and how to open one from the Diff view. */
export const DocumentContentsContext = createContext<{
  entries: readonly ReviewTocEntry[];
  open(headingId: string): void;
}>({ entries: [], open: () => {} });

/**
 * Folded Whiteboards and Contents at the top of the Diff view's own sidebar,
 * used when Desktop's sidebar is not showing the board.
 */
export function DiffSidebarFolds(): ReactElement {
  const session = useReviewSession();

  const { entries: contents, open: onOpenHeading } = useContext(
    DocumentContentsContext,
  );

  const [project, setProject] = useState<ProjectBoards | null>(null);
  const [open, setOpen] = useState<"whiteboards" | "contents" | null>(null);
  const [reads, setReads] = useState(0);

  // The project's boards change elsewhere: read them again when the window
  // comes back.
  useEffect(() => {
    const reread = () => setReads((count) => count + 1);

    window.addEventListener("focus", reread);

    return () => window.removeEventListener("focus", reread);
  }, []);

  const listing = open === "whiteboards";

  useEffect(() => {
    let current = true;

    void session
      .fetch("/project")
      .then(async (response) =>
        response.ok ? projectSchema.parse(await response.json()) : null,
      )
      .catch(() => null)
      .then((value) => {
        if (current) setProject(value);
      });

    return () => {
      current = false;
    };
    // Opening the list reads it again too.
  }, [session, reads, listing]);

  const label = project?.project?.name.split("/").at(-1);

  const toggle = (section: "whiteboards" | "contents") =>
    setOpen(open === section ? null : section);

  return (
    <>
      {project?.project ? (
        <>
          <Header
            title="Whiteboards"
            count={project.boards.length}
            project={label}
            open={open === "whiteboards"}
            onToggle={() => toggle("whiteboards")}
          />
          {open === "whiteboards" ? (
            <WhiteboardsList
              project={project}
              current={session.config.reviewId}
              onOpen={(reviewUuid, active) =>
                void session.surface.post({
                  name: "openReview",
                  args: { reviewUuid, active },
                })
              }
            />
          ) : null}
        </>
      ) : null}
      {contents.length ? (
        <>
          <Header
            title="Contents"
            count={contents.length}
            open={open === "contents"}
            onToggle={() => toggle("contents")}
          />
          {open === "contents" ? (
            <ContentsList entries={contents} onOpen={onOpenHeading} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Header({
  title,
  count,
  project,
  open,
  onToggle,
}: {
  title: string;
  count: number;
  project?: string;
  open: boolean;
  onToggle(): void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      {...stylex.props(styles.header)}
    >
      <svg viewBox="0 0 12 12" aria-hidden {...stylex.props(styles.chevron)}>
        <path d={open ? "M3 4.5 L6 7.5 L9 4.5" : "M4.5 3 L7.5 6 L4.5 9"} />
      </svg>
      <span {...stylex.props(styles.title)}>{title}</span>
      <span {...stylex.props(styles.faint)}>{count}</span>
      {project ? (
        <>
          <span {...stylex.props(styles.ghost)}>·</span>
          <span {...stylex.props(styles.faint)}>{project}</span>
        </>
      ) : null}
    </button>
  );
}

const styles = stylex.create({
  header: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "6px",
    width: "100%",
    height: "30px",
    paddingBlock: 0,
    paddingLeft: "10px",
    paddingRight: "14px",
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: "transparent",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: "14px",
    textAlign: "left",
    cursor: "pointer",
  },
  chevron: {
    flexShrink: 0,
    width: "12px",
    height: "12px",
    fill: "none",
    stroke: tokens.inkMuted,
    strokeWidth: 1.3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  title: {
    color: tokens.inkMuted,
    fontWeight: fontWeight.semibold,
    letterSpacing: tracking.caps,
    textTransform: "uppercase",
  },
  faint: { color: tokens.inkFaint },
  ghost: { color: tokens.ghost },
});
