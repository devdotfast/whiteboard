import { z } from "zod";

export const SHARE_FORMAT = "review-share/2";

/** UTF-8 bytes of a bundle's JSON, as uploaded and as stored. */
export const MAX_SHARE_BYTES = 16 * 1024 * 1024;

export const shareIdSchema = z.uuid();

export const capabilitySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const sharePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (file) =>
      !file.startsWith("/") &&
      !file.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(file) &&
      file
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Use a repository-relative file path.",
  );

/** The published identity is independent of the author's credential transport. */
export function normalizeGitHubRemote(remote: string): string {
  const url = new URL(
    remote.trim().replace(/^git@github\.com:/, "https://github.com/"),
  );

  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    url.hostname !== "github.com" ||
    url.port ||
    url.search ||
    url.hash ||
    (url.protocol === "ssh:" && url.username !== "git")
  )
    throw new Error("Sharing requires a GitHub repository remote.");

  const parts = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .slice(1);

  if (
    parts.length !== 2 ||
    parts.some(
      (part) =>
        !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
    )
  )
    throw new Error("Sharing requires a GitHub repository remote.");

  return `https://github.com/${parts.join("/")}.git`;
}

export const gitHubRepositoryUrlSchema = z.string().refine((value) => {
  try {
    return normalizeGitHubRemote(value) === value;
  } catch {
    return false;
  }
}, "Use a canonical GitHub HTTPS repository URL without credentials.");

const commitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);

const sideSchema = z.enum(["base", "head"]);

/** An excerpt is the lines a board references. */
export const shareSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("excerpt"),
    file: sharePathSchema,
    commit: commitSchema,
    fromLine: z.number().int().positive(),
    lines: z.array(z.string()).min(1),
  }),
]);

const lineRangeSchema = z.strictObject({
  side: sideSchema,
  file: sharePathSchema,
  fromLine: z.number().int().positive(),
  toLine: z.number().int().positive(),
  pins: z
    .strictObject({
      repositoryId: z.string(),
      head: z.string(),
      base: z.string().optional(),
    })
    .optional(),
});

export const shareBundleSchema = z.strictObject({
  format: z.literal(SHARE_FORMAT),
  reviewId: z.string().min(1).max(256),
  version: z.number().int().nonnegative(),
  title: z.string().min(1).max(4096),
  /** Validated against the document schema by the reader. */
  snapshot: z.record(z.string(), z.unknown()),
  images: z.record(z.string(), z.strictObject({ png: z.base64() })),
  traces: z.record(z.string(), z.unknown()),
  maps: z.record(z.string(), z.unknown()),
  commits: z.array(z.unknown()),
  /** Each reference's lines, resolved where the board was shared. */
  selections: z.record(z.string(), z.array(lineRangeSchema)),
  sources: z.array(shareSourceSchema),
  repository: z
    .strictObject({ cloneUrl: gitHubRepositoryUrlSchema })
    .optional(),
});

export type ShareBundle = z.infer<typeof shareBundleSchema>;

export type ShareSource = z.infer<typeof shareSourceSchema>;

export const createShareSchema = z.strictObject({
  requestId: z.uuid(),
  bundle: shareBundleSchema,
});

export function shareLink(origin: string, capability: string): string {
  return new URL(`/s/${capabilitySchema.parse(capability)}`, origin).href;
}

export function parseShareLink(value: string) {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "app")
  )
    throw new Error("Use an HTTPS Whiteboard share link.");

  return {
    origin: url.origin,
    capability: capabilitySchema.parse(
      /^\/s\/([^/]+)$/.exec(url.pathname)?.[1],
    ),
  };
}
