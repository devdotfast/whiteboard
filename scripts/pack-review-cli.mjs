import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stageReviewDocs } from "../apps/review-desktop/scripts/stage-review-runtime.mjs";
import { stageVscodeServer } from "../apps/review-desktop/scripts/stage-vscode-server.mjs";
import { distTag } from "./review-cli-release.mjs";

/** npm serves larger tarballs, but a remote downloads this one on every upgrade. */
export const MAX_TARBALL_BYTES = 60 * 1024 * 1024;

/**
 * Pack from the workspace, then add the docs, the VS Code server and the
 * version metadata shipped by Desktop.
 */
export async function packReviewCli(
  { version, commit },
  outputDirectory,
  {
    packageDirectory = "packages/review",
    stdio = "inherit",
    vscodeServer = {},
    maxBytes = MAX_TARBALL_BYTES,
  } = {},
) {
  distTag(version);

  const actualCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  if (actualCommit !== commit)
    throw new Error("Release source differs from the planned commit");
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const scratch = await mkdtemp(path.join(os.tmpdir(), "review-cli-pack-"));
  const manifestPath = path.join(packageDirectory, "package.json");
  const original = await readFile(manifestPath, "utf8");

  try {
    const pkg = JSON.parse(original);
    // npm names a scoped tarball <scope>-<name>-<version>.tgz.
    const tarball = `${pkg.name.slice(1).replace("/", "-")}-${version}.tgz`;
    pkg.version = version;
    pkg.gitHead = commit;
    await writeFile(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
    execFileSync(
      "pnpm",
      ["--dir", packageDirectory, "pack", "--pack-destination", scratch],
      { stdio },
    );
    execFileSync("tar", [
      "-xzf",
      path.join(scratch, tarball),
      "-C",
      scratch,
    ]);
    const staged = path.join(scratch, "package");
    await stageReviewDocs(staged);
    await stageVscodeServer(staged, { ...vscodeServer, commit });

    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", output],
      { cwd: staged, stdio },
    );

    const packed = path.join(output, tarball);
    const { size } = await stat(packed);

    if (size > maxBytes)
      throw new Error(
        `${tarball} is ${size} bytes, over the ${maxBytes}-byte limit`,
      );

    return packed;
  } finally {
    await writeFile(manifestPath, original);
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = JSON.parse(await readFile("release-plan.json", "utf8"));
  console.log(
    await packReviewCli(plan, process.argv[2] || "release-artifacts"),
  );
}
