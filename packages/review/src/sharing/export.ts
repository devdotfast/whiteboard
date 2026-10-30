import {
  MAX_SHARE_BYTES,
  SHARE_FORMAT,
  type ShareBundle,
  type ShareSource,
} from "@dev.fast/review-share-protocol";
import {
  type FileLineRange,
  type LensSource,
  type Pins,
  ReviewInputError,
  anchorPins,
  boardRepositoryId,
  checkReferences,
  documentSchema,
  elements,
  lensSelections,
  markdownNodes,
  parseMarkdown,
  readsAtBoardPins,
  resourceReference,
  resourceReferences,
  selectionKey,
  selectionReferences,
  sourceAnchors,
  sourceReferences,
} from "@dev.fast/whiteboard-document";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import { reviewProgress } from "@review/review-api/review-progress.js";
import type { ReviewStore, Snapshot } from "@review/review-api/store.js";

export function validateShareSources(
  snapshot: Pick<Snapshot, "pins" | "document" | "lenses">,
) {
  if (!snapshot.pins && readsAtBoardPins(snapshot))
    throw new ReviewInputError(
      "Reviews with code references need source pins before sharing.",
      409,
    );
}

/** The commits a board's references read at besides its base and head. A
 * Desktop recipient fetches them too. A shared board names no repository of
 * its own, so one stands in for its commit links. */
export function referenceCommits(
  snapshot: Pick<Snapshot, "pins" | "document" | "target">,
  repositoryId = boardRepositoryId(snapshot) ?? "shared",
): string[] {
  const own = new Set([snapshot.pins?.base, snapshot.pins?.head]);
  const commits = new Set<string>();

  for (const { source } of sourceReferences(snapshot.document, {
    tolerant: true,
    repositoryId,
  }))
    for (const commit of [source.pins?.base, source.pins?.head])
      if (commit && !own.has(commit)) commits.add(commit);

  return [...commits].sort();
}

interface ExcerptRange {
  pins: Pins;
  side: "base" | "head";
  file: string;
  fromLine: number;
  toLine: number;
}

/** One excerpt per run of overlapping or adjacent lines in a file at a commit. */
async function cutExcerpts(
  data: {
    quote(
      pins: Pins,
      range: Omit<ExcerptRange, "pins">,
    ): Promise<{ commit: string; text: string }>;
  },
  ranges: ExcerptRange[],
): Promise<ShareSource[]> {
  const groups = new Map<string, ExcerptRange[]>();

  for (const range of ranges) {
    const key = JSON.stringify([range.pins[range.side], range.file]);
    groups.set(key, [...(groups.get(key) ?? []), range]);
  }

  const merged = [...groups.values()].flatMap((group) =>
    group
      .toSorted((a, b) => a.fromLine - b.fromLine)
      .reduce<ExcerptRange[]>((runs, range) => {
        const last = runs.at(-1);

        if (last && range.fromLine <= last.toLine + 1)
          last.toLine = Math.max(last.toLine, range.toLine);
        else runs.push({ ...range });

        return runs;
      }, []),
  );

  return Promise.all(
    merged.map(async ({ pins, ...range }) => {
      const quote = await data.quote(pins, range);

      return {
        kind: "excerpt" as const,
        file: range.file,
        commit: quote.commit,
        fromLine: range.fromLine,
        lines: excerptLines(quote.text),
      };
    }),
  );
}

// jsonb cannot store NUL.
const excerptLines = (text: string) =>
  text.split(/\r?\n/).map((line) => line.replaceAll("\0", "\uFFFD"));

/** The create request body, within the upload limit. */
export function shareRequestBody(bundle: ShareBundle, requestId: string) {
  const body = JSON.stringify({ requestId, bundle });

  if (Buffer.byteLength(body) > MAX_SHARE_BYTES)
    throw new ReviewInputError(
      `Review exceeds the ${MAX_SHARE_BYTES / 1024 / 1024} MB sharing limit. Remove large traces, then retry.`,
    );

  return body;
}

/** Freeze one stored version before any asynchronous source reads. */
export async function exportShare(input: {
  store: ReviewStore;
  data: LocalReviewData;
  reviewId: string;
  version?: number;
  repository?: ShareBundle["repository"];
}): Promise<ShareBundle> {
  const stored = structuredClone(
    input.store.read(input.reviewId, input.version),
  );

  // Commit links read from the board's repository, which a plan names only
  // in its target.
  const repositoryId = boardRepositoryId(stored);

  // Local-only fields stay home; the target names a local checkout.
  const {
    target,
    staleSources: _staleSources,
    sourceUnavailable: _sourceUnavailable,
    lastEdit: _lastEdit,
    trashedAt: _trashedAt,
    personEdit: _personEdit,
    ...snapshot
  } = stored;

  if (target?.kind === "worktree")
    throw new ReviewInputError("Pin this review to commits before sharing it.");

  // A viewer has no PR state to read the base branch from.
  const pullRequestUrl = snapshot.origin?.pullRequestUrl;

  const baseBranch =
    pullRequestUrl &&
    !snapshot.origin?.baseBranch &&
    (snapshot.origin?.pullRequestBaseBranch ??
      input.data.pullRequestBaseBranch(pullRequestUrl));

  if (baseBranch) snapshot.origin = { ...snapshot.origin, baseBranch };

  documentSchema.parse(snapshot.document);
  checkReferences(snapshot.document);
  validateShareSources(snapshot);

  for (const block of elements(snapshot.document)) {
    if (block.type !== "markdown") continue;

    for (const node of markdownNodes(parseMarkdown(block.markdown)))
      if (node.type === "image")
        throw new ReviewInputError(
          "Convert Markdown images to managed image blocks before sharing.",
        );
  }

  const pins = snapshot.pins;

  // Lens ranges travel with the snapshot and must resolve at its pins too.
  const references: {
    source: FileLineRange;
    peek?: boolean;
  }[] = [
    ...sourceReferences(snapshot.document, { repositoryId }),
    ...lensSelections(snapshot.lenses ?? []).flatMap((selection) =>
      sourceAnchors(selection.source).map((source) => ({ source })),
    ),
  ];

  const traces = new Map<string, unknown>();
  const maps = new Map<string, Awaited<ReturnType<LocalReviewData["map"]>>>();

  for (const block of resourceReferences(snapshot.document)) {
    await input.data.validateResource(pins, block);
    const id = resourceReference(block)?.id;

    if (!id || block.type === "image" || traces.has(id) || maps.has(id))
      continue;

    if (block.type === "trace_quote")
      traces.set(
        id,
        JSON.parse(Buffer.from(input.store.resource(id).data).toString()),
      );
    else if (block.type === "software_map") {
      const map = await input.data.map(pins, id);
      maps.set(id, map);

      for (const element of map.elements)
        for (const range of element.sourceRanges ?? [])
          references.push({ source: { ...range, side: map.side } });
    } else throw new ReviewInputError("A shared resource has the wrong type.");
  }

  for (const reference of references)
    await input.data.validateSource(
      anchorPins(reference.source, pins),
      reference.source,
      { peek: reference.peek ?? false },
    );

  const { resolvedSelections } = await reviewProgress(
    input.store,
    input.data,
    stored,
  );

  const selected = new Map<string, LensSource>(
    [
      ...lensSelections(snapshot.lenses ?? []),
      ...selectionReferences(snapshot.document, {
        tolerant: true,
        repositoryId,
      }),
    ].map(({ source }) => [selectionKey(source), source]),
  );

  const selections = Object.fromEntries(
    Object.entries(resolvedSelections).map(([key, ranges]) => {
      const own = selected.get(key)?.pins;

      return [
        key,
        ranges.map((range) => ({ ...range, ...(own && { pins: own }) })),
      ];
    }),
  );

  const excerpts: ExcerptRange[] = [
    ...Object.values(selections).flat(),
    ...[...maps.values()].flatMap((map) =>
      map.elements.flatMap((element) =>
        (element.sourceRanges ?? []).map((range) => ({
          ...range,
          side: map.side,
        })),
      ),
    ),
  ].map(({ side = "head", file, fromLine, toLine, ...range }) => ({
    pins: anchorPins(range, pins),
    side,
    file,
    fromLine,
    toLine,
  }));

  return {
    format: SHARE_FORMAT,
    reviewId: snapshot.reviewId,
    version: snapshot.version,
    title: snapshot.title,
    snapshot,
    images: {},
    traces: Object.fromEntries(traces),
    maps: Object.fromEntries(maps),
    commits: pins
      ? await input.data.commits((await input.data.resolveSource(stored)).pins)
      : [],
    selections,
    sources: await cutExcerpts(input.data, excerpts),
    ...(input.repository && { repository: input.repository }),
  };
}
