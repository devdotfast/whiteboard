import { fileURLToPath } from "node:url";

import { z } from "zod";

const registrySchema = z.object({
  versions: z.record(z.string(), z.object({ gitHead: z.string().optional() })),
});

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const preview =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.\d{8}\.[1-9]\d*$/;

export const packageName = "@dev.fast/whiteboard";

/** The npm dist-tag for a Desktop version; a prerelease never becomes `latest`. */
export function distTag(version) {
  if (stable.test(version)) return "latest";

  if (preview.test(version)) return "preview";

  throw new Error(`Expected X.Y.Z or X.Y.Z-preview.YYYYMMDD.N, got ${version}`);
}

export async function registryMetadata(send = fetch) {
  const response = await send(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  if (response.status === 404) return { versions: {} };

  if (!response.ok)
    throw new Error(
      `npm registry lookup failed (${response.status}); refusing to guess a version`,
    );
  const parsed = registrySchema.safeParse(await response.json());

  if (!parsed.success) throw new Error("Invalid npm registry metadata");

  return parsed.data;
}

/** Existing versions are immutable; a rerun may only accept this source commit. */
export function alreadyPublished(metadata, version, commit) {
  const published = metadata.versions[version];

  if (!published) return false;

  if (published.gitHead !== commit)
    throw new Error(
      `${packageName}@${version} already exists from another or unknown commit. Choose a new version.`,
    );

  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, version, commit] = process.argv.slice(2);

  if (mode === "dist-tag") console.log(distTag(version));
  else if (mode === "published")
    console.log(alreadyPublished(await registryMetadata(), version, commit));
  else
    throw new Error(
      "Usage: review-cli-release.mjs dist-tag <version> | published <version> <commit>",
    );
}
