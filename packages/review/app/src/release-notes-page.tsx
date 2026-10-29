import { space } from "@canvas/scale.stylex";
import { EmptyState } from "@canvas/ui/empty-state";
import { Spinner } from "@canvas/ui/spinner";
import {
  type ReviewCanvasReleaseNotes,
  whiteboardReleaseApiUrl,
  whiteboardReleaseUrl,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { MarkdownContent } from "./agent-markdown";
import { createCanvasQueryClient } from "./canvas-query";
import { homeStyles } from "./home-styles";
import { documentMarker, proseMarker } from "./markers.stylex";
import { settingsStyles } from "./settings-styles";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

interface Release {
  body: string;
  published_at: string | null;
}

/** GitHub release bodies mix Markdown with HTML, which renders as text here:
 * an <img> becomes a Markdown image and its wrappers drop. */
function releaseMarkdown(body: string): string {
  return body
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc="([^"]+)"/i.exec(tag)?.[1];
      const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] ?? "";

      return src ? `![${alt.replace(/[[\]]/g, "")}](${src})` : "";
    })
    .replace(/<\/?(?:p|div|br|center)\b[^>]*>/gi, "");
}

async function fetchRelease(version: string): Promise<Release> {
  const response = await fetch(whiteboardReleaseApiUrl(version), {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok)
    throw new Error(
      response.status === 404
        ? `Whiteboard ${version} has no release notes yet.`
        : `GitHub answered ${response.status}.`,
    );

  return response.json();
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

  const release = useQuery({
    queryKey: ["release-notes", version],
    queryFn: () => fetchRelease(version),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const published = release.data?.published_at
    ? new Date(release.data.published_at).toLocaleDateString(undefined, {
        dateStyle: "long",
      })
    : undefined;

  const github = (
    <a
      href={whiteboardReleaseUrl(version)}
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
            <h1 {...stylex.props(homeStyles.heading)}>
              What's new in {version}
            </h1>
          </div>
          <p {...stylex.props(settingsStyles.lede, styles.lede)}>
            {published ? `Released ${published} · ` : null}
            {github}
          </p>
          {release.isPending ? (
            <Spinner label="Loading release notes" />
          ) : release.isError ? (
            <EmptyState
              role="alert"
              title="Release notes unavailable"
              message={release.error.message}
              action={github}
            />
          ) : (
            // Prose styles hold only inside a document.
            <div {...stylex.props(documentMarker, proseMarker)}>
              <MarkdownContent
                source={releaseMarkdown(release.data.body)}
                allowRemoteImages
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const styles = stylex.create({
  lede: {
    marginTop: space.s8,
  },
  link: {
    color: tokens.accent,
  },
});
