import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRemoteRuntime } from "../apps/review-desktop/scripts/build-remote-runtime.mjs";
import { stageReviewDocs } from "../apps/review-desktop/scripts/stage-review-runtime.mjs";
import { stageVscodeServer } from "../apps/review-desktop/scripts/stage-vscode-server.mjs";
import { distTag } from "./review-cli-release.mjs";

export const MAX_TARBALL_BYTES = 60 * 1024 * 1024;

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
  const manifestPath = path.join(packageDirectory, "package.json");
  const original = await readFile(manifestPath, "utf8");

  try {
    const pkg = JSON.parse(original);
    pkg.version = version;
    pkg.gitHead = commit;
    await writeFile(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);

    return await packStaged(output, {
      packageDirectory,
      commit,
      stdio,
      vscodeServer,
      maxBytes,
    });
  } finally {
    await writeFile(manifestPath, original);
  }
}

export async function packDevelopment(
  commit,
  outputDirectory,
  { stdio = "inherit", version } = {},
) {
  await buildRemoteRuntime({ commit });

  return packStaged(path.resolve(outputDirectory), {
    packageDirectory: "packages/review",
    commit,
    stdio,
    version,
  });
}

async function packStaged(
  output,
  {
    packageDirectory,
    commit,
    stdio,
    vscodeServer = {},
    maxBytes = MAX_TARBALL_BYTES,
    version,
  },
) {
  await mkdir(output, { recursive: true });
  const scratch = await mkdtemp(path.join(os.tmpdir(), "review-cli-pack-"));

  try {
    execFileSync(
      "pnpm",
      ["--dir", packageDirectory, "pack", "--pack-destination", scratch],
      { stdio },
    );

    let tarball = (await readdir(scratch)).find((name) =>
      name.endsWith(".tgz"),
    );

    execFileSync("tar", ["-xzf", path.join(scratch, tarball), "-C", scratch]);
    const staged = path.join(scratch, "package");

    if (version) {
      const manifestPath = path.join(staged, "package.json");
      const pkg = JSON.parse(await readFile(manifestPath, "utf8"));
      pkg.version = version;
      await writeFile(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
      tarball = `${pkg.name.slice(1).replace("/", "-")}-${version}.tgz`;
    }

    await stageReviewDocs(staged);
    await stageVscodeServer(staged, { ...vscodeServer, commit });

    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", output],
      { cwd: staged, stdio },
    );

    const packed = path.join(output, tarball);
    const { size } = await stat(packed);

    if (size > maxBytes) {
      await rm(packed, { force: true });
      throw new Error(
        `${tarball} is ${size} bytes, over the ${maxBytes}-byte limit`,
      );
    }

    return packed;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === "--dev"
) {
  console.log(
    await packDevelopment(process.argv[3], process.argv[4], {
      stdio: "pipe",
      version: process.argv[5],
    }),
  );
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = JSON.parse(await readFile("release-plan.json", "utf8"));
  console.log(
    await packReviewCli(plan, process.argv[2] || "release-artifacts"),
  );
}
