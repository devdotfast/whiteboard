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
