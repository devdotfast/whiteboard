import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The checkout's files relative to its root: tracked ones, and new ones git
 * does not ignore. None where git cannot list them. */
export async function checkoutFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    return [...new Set(stdout.split("\0").filter(Boolean))];
  } catch {
    return [];
  }
}

/** How long a listing serves mentions before git is asked again. */
const LISTING_MS = 10_000;

const listings = new Map<string, { at: number; files: Promise<string[]> }>();

/** The checkout's files for a mention picker, which asks on each keystroke:
 * listed again only once the last listing is a few seconds old. */
export function mentionableFiles(root: string): Promise<string[]> {
  const now = Date.now();
  const listed = listings.get(root);

  if (listed && now - listed.at < LISTING_MS) return listed.files;
  const files = checkoutFiles(root);

  listings.set(root, { at: now, files });

  return files;
}
