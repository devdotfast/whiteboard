import { buttonStyles } from "@canvas/ui/button";
import { DisclosureChevron, disclosureStyles } from "@canvas/ui/disclosure";
import { focusStyles } from "@canvas/ui/focus";
import { textStyles } from "@canvas/ui/text";
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
import { chevronMarker } from "./markers.stylex";
import type { ReviewTocEntry } from "./review-document-headings";
import { fontSize, leading, space } from "./scale.stylex";
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
      {...stylex.props(
        chevronMarker,
        focusStyles.ringInset,
        buttonStyles.reset,
        disclosureStyles.toggle,
        styles.header,
      )}
    >
      <DisclosureChevron xstyle={styles.chevron} />
      <span {...stylex.props(textStyles.sectionTitle)}>{title}</span>
      <span {...stylex.props(textStyles.count, styles.faint)}>{count}</span>
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
    gap: space.s6,
    width: "100%",
    height: "30px",
    paddingBlock: 0,
    paddingLeft: space.s10,
    paddingRight: space.s14,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: leading.px14,
  },
  chevron: { margin: 0 },
  faint: { color: tokens.inkFaint },
  ghost: { color: tokens.ghost },
});
