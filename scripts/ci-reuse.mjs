import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function findReusableRun({ api, tree, runId, cacheKeys }) {
  try {
    const name = `ci-tree-${tree}`;
    const { artifacts } = await api(`artifacts?name=${name}&per_page=100`);

    const candidates = artifacts.filter(
      (artifact) =>
        artifact.name === name &&
        !artifact.expired &&
        artifact.workflow_run &&
        String(artifact.workflow_run.id) !== String(runId),
    );

    if (!candidates.length) return;

    const current = await api(`runs/${runId}`);

    for (const artifact of candidates) {
      const run = await api(`runs/${artifact.workflow_run.id}`);

      if (
        run.workflow_id !== current.workflow_id ||
        run.status !== "completed" ||
        run.conclusion !== "success" ||
        !["pull_request", "push", "workflow_dispatch"].includes(run.event)
      ) {
        continue;
      }

      for (const key of cacheKeys) {
        const { actions_caches: caches } = await api(
          `caches?ref=refs%2Fheads%2Fmain&key=${encodeURIComponent(key)}&per_page=100`,
        );

        if (
          !caches.some(
            (cache) => cache.ref === "refs/heads/main" && cache.key === key,
          )
        ) {
          return;
        }
      }

      return run.html_url;
    }
  } catch (error) {
    console.warn(
      `Could not verify reusable CI; running full CI: ${error.message}`,
    );
  }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();

  const api = async (path) => {
    const response = await fetch(
      `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/actions/${path}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

    return response.json();
  };

  const run = await findReusableRun({
    api,
    tree,
    runId: process.env.GITHUB_RUN_ID,
    cacheKeys: [
      process.env.CODE_OSS_CACHE_KEY,
      process.env.PLAYWRIGHT_CACHE_KEY,
    ],
  });

  appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${Boolean(run)}\n`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    run
      ? `Reusing [successful CI](${run}) for identical tree \`${tree}\`; shared caches are warm.\n`
      : "No verified successful tree match with warm shared caches; running full CI.\n",
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
