import { fontSize, fontWeight, space } from "@canvas/scale.stylex";
import { Checkbox } from "@canvas/ui/checkbox";
import { Chip } from "@canvas/ui/chip";
import { EmptyState } from "@canvas/ui/empty-state";
import { Spinner } from "@canvas/ui/spinner";
import {
  type ReviewCanvasRelease,
  type ReviewCanvasReleaseNotes,
  WHITEBOARD_RELEASES_URL,
  whiteboardReleaseUrl,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { MarkdownContent } from "./agent-markdown";
import { createCanvasQueryClient } from "./canvas-query";
import { homeStyles } from "./home-styles";
import { documentMarker, proseMarker } from "./markers.stylex";
import { settingsStyles } from "./settings-styles";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

/** GitHub release bodies mix Markdown with HTML, which renders as text here:
 * an <img> becomes a Markdown image and its wrappers drop. */
function releaseMarkdown(body: string): string {
  return body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc="([^"]+)"/i.exec(tag)?.[1];
      const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] ?? "";

      return src ? `![${alt.replace(/[[\]]/g, "")}](${src})` : "";
    })
    .replace(/<\/?(?:p|div|br|center)\b[^>]*>/gi, "");
}

export function ReleaseNotesPage(props: {
  releaseNotes: ReviewCanvasReleaseNotes;
}) {
  const [client] = useState(createCanvasQueryClient);

  return (
    <QueryClientProvider client={client}>
      <ReleaseNotes {...props} />
    </QueryClientProvider>
  );
}

function ReleaseNotes({
  releaseNotes,
}: {
  releaseNotes: ReviewCanvasReleaseNotes;
}) {
  const { version } = releaseNotes;

  const [showAfterUpdate, setShowAfterUpdate] = useState(
    releaseNotes.showAfterUpdate,
  );

  const releases = useQuery({
    queryKey: ["release-notes"],
    queryFn: () => releaseNotes.readReleases(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const github = (
    <a
      href={WHITEBOARD_RELEASES_URL}
      target="_blank"
      rel="noreferrer"
      {...stylex.props(styles.link)}
    >
      View on GitHub
    </a>
  );

  return (
    <main {...withClass("review-home", homeStyles.page)}>
      <div {...stylex.props(homeStyles.scroll)}>
        <div {...stylex.props(homeStyles.content, settingsStyles.page)}>
          <div {...stylex.props(homeStyles.header)}>
            <h1 {...stylex.props(homeStyles.heading)}>Release notes</h1>
            <label {...stylex.props(styles.toggle)}>
              <Checkbox
                checked={showAfterUpdate}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setShowAfterUpdate(enabled);
                  void releaseNotes
                    .setShowAfterUpdate(enabled)
                    .then(setShowAfterUpdate, () =>
                      setShowAfterUpdate(!enabled),
                    );
                }}
              />
              Show after an update
            </label>
          </div>
          <p {...stylex.props(settingsStyles.lede, styles.lede)}>
            Every Whiteboard release · {github}
          </p>
          {releases.isPending ? (
            <Spinner label="Loading release notes" />
          ) : releases.isError ? (
            <EmptyState
              role="alert"
              title="Release notes unavailable"
              message={releases.error.message}
              action={github}
            />
          ) : (
            releases.data.map((release, index) => {
              const target = release.tag_name === `v${version}`;

              return (
                <Release
                  key={release.tag_name}
                  release={release}
                  target={target}
                  // The newest release already sits under the header.
                  scrollTo={target && index > 0}
                />
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}

function Release({
  release,
  target,
  scrollTo,
}: {
  release: ReviewCanvasRelease;
  target: boolean;
  scrollTo: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  // Scroll anchoring holds the spot while images above load.
  useLayoutEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: "start" });
  }, [scrollTo]);

  const version = release.tag_name.slice(1);

  const published = release.published_at
    ? new Date(release.published_at).toLocaleDateString(undefined, {
        dateStyle: "long",
      })
    : undefined;

  return (
    <section ref={ref} {...stylex.props(styles.release)}>
      <h2 {...stylex.props(styles.releaseHeading)}>
        {release.name || `Whiteboard ${version}`}
        {target ? <Chip variant="pill">This version</Chip> : null}
      </h2>
      <p {...stylex.props(styles.releaseMeta)}>
        {published ? `Released ${published} · ` : null}
        <a
          href={whiteboardReleaseUrl(version)}
          target="_blank"
          rel="noreferrer"
          {...stylex.props(styles.link)}
        >
          View on GitHub
        </a>
      </p>
      {/* Prose styles hold only inside a document. */}
      <div {...stylex.props(documentMarker, proseMarker)}>
        <MarkdownContent
          source={releaseMarkdown(release.body)}
          allowRemoteImages
        />
      </div>
    </section>
  );
}

const styles = stylex.create({
  toggle: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: space.s8,
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
    cursor: "pointer",
  },
  lede: {
    marginTop: space.s8,
  },
  link: {
    color: tokens.accent,
  },
  release: {
    paddingBlock: space.s28,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  releaseHeading: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    margin: 0,
    color: tokens.ink,
    fontSize: fontSize.display,
    fontWeight: fontWeight.semibold,
  },
  releaseMeta: {
    margin: `${space.s4} 0 ${space.s14}`,
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
  },
});
