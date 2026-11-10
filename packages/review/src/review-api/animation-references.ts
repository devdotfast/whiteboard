// The reference animations shipped in instructions/animations: worked examples
// an agent copies as a starting point. Each folder is an animation draft plus a
// README, read by the same code that publishes a draft.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ReviewInputError } from "@dev.fast/whiteboard-document";
import { isMissingFileError } from "@review/fs-utils.js";
import { findReviewPackageRoot } from "@review/package-paths.js";

import { readAnimationFolder } from "./animation-drafts.js";

export type AnimationReference = {
  name: string;
  directory: string;
  title: string;
  summary: string;
};

/** The README's H1 and the paragraph right after it. */
function readmeHeading(file: string, text: string) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim());
  const title = lines[start]?.match(/^# (.+)$/)?.[1]?.trim();
  const rest = lines.slice(start + 1);
  const from = rest.findIndex((line) => line.trim());
  const paragraph = [];

  for (const line of from < 0 ? [] : rest.slice(from)) {
    if (!line.trim() || line.startsWith("#")) break;
    paragraph.push(line.trim());
  }

  const summary = paragraph.join(" ");

  if (!title || !summary)
    throw new ReviewInputError(
      `${file} must open with "# Title" followed by a one-sentence summary paragraph.`,
    );

  return { title, summary };
}

/** Every reference animation, sorted by name, each checked as a publish would
 * be. Strict (the default) throws on a broken reference, for the tests that
 * keep them valid; otherwise a broken one is left out, so an agent's checkout
 * and instructions never fail on a reference. `folder` "diagrams" reads the
 * reference diagrams instead. */
export async function readAnimationReferences(
  root = findReviewPackageRoot(import.meta.url),
  {
    strict = true,
    folder = "animations",
  }: { strict?: boolean; folder?: "animations" | "diagrams" } = {},
): Promise<AnimationReference[]> {
  const parent = path.join(root, "instructions", folder);
  let entries;

  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const references = await Promise.all(
    names.map(async (name): Promise<AnimationReference | undefined> => {
      const directory = path.join(parent, name);
      const readme = path.join(directory, "README.md");

      try {
        await readAnimationFolder(directory);

        return {
          name,
          directory,
          ...readmeHeading(readme, await readFile(readme, "utf8")),
        };
      } catch (error) {
        if (!strict) return undefined;

        throw new ReviewInputError(
          `Reference ${folder === "diagrams" ? "diagram" : "animation"} ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  return references.filter((reference) => reference !== undefined);
}
