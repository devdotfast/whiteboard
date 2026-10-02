import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { findReviewPackageRoot } from "@review/package-paths";
import { z } from "zod";

const exec = promisify(execFile);

const versionSchema = z.object({ version: z.string() });

const stampSchema = z.object({ version: z.string(), full: z.boolean() });

const pending = new Map<string, Promise<void>>();

function configuration(root: string) {
  const installer = path.join(root, "bin/diffr-package/bin/fetch.mjs");

  const { version } = versionSchema.parse(
    JSON.parse(
      readFileSync(path.join(root, "bin/diffr-package/package.json"), "utf8"),
    ),
  );

  const directory = path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "diffr",
    version,
    `${process.platform}-${process.arch}`,
    "full",
  );

  return {
    installer,
    version,
    directory,
    binary: path.join(
      directory,
      process.platform === "win32" ? "diffr.exe" : "diffr",
    ),
  };
}

export function installedFullDiffr(root: string): string | undefined {
  try {
    const { binary, directory, version } = configuration(root);
    const stat = lstatSync(binary);

    const stamp = stampSchema.parse(
      JSON.parse(
        readFileSync(path.join(directory, "diffr.stamp.json"), "utf8"),
      ),
    );

    if (
      stat.isFile() &&
      (process.platform === "win32" || stat.mode & 0o111) &&
      stamp.full &&
      stamp.version === version
    )
      return binary;
  } catch {}

  return undefined;
}

export function installFullDiffr(
  root = findReviewPackageRoot(import.meta.url),
): Promise<void> {
  if (process.env.REVIEW_DIFFR_BINARY)
    return Promise.reject(
      new Error(
        "An explicitly selected diffr executable is in use. Install its full edition separately.",
      ),
    );
  const { installer, directory } = configuration(root);
  const current = pending.get(directory);

  if (current) return current;

  const task = exec(
    process.execPath,
    [installer, "--full", "--required", "--into", directory],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 180_000,
    },
  )
    .then(() => {})
    .finally(() => pending.delete(directory));

  pending.set(directory, task);

  return task;
}
