import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

// Waits in this workflow run for a sibling job's artifact, so a job can start
// before that job finishes and block only where it needs the artifact.
const { values } = parseArgs({
  options: {
    job: { type: "string" },
    artifact: { type: "string" },
    interval: { type: "string", default: "10000" },
  },
});

const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_OUTPUT, GH_TOKEN } = process.env;

const run = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;

async function list(path, key) {
  const items = [];

  for (let page = 1; ; page++) {
    const response = await fetch(`${run}/${path}per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json" },
    });

    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    const batch = (await response.json())[key];
    items.push(...batch);

    if (batch.length < 100) return items;
  }
}

for (;;) {
  let jobs, artifacts;

  try {
    jobs = await list("jobs?filter=latest&", "jobs");
    artifacts = await list("artifacts?", "artifacts");
  } catch (error) {
    console.log(`Retrying: ${error.message}`);
    await sleep(Number(values.interval));
    continue;
  }

  const conclusion = jobs.find((job) => job.name.endsWith(values.job))?.conclusion;

  if (conclusion && conclusion !== "success") {
    console.log(`::error::${values.job} finished (${conclusion}).`);
    process.exit(1);
  }

  const found = artifacts
    .filter((a) => a.name === values.artifact && !a.expired)
    .sort((a, b) => b.id - a.id)[0];

  if (found) {
    appendFileSync(GITHUB_OUTPUT, `artifact-id=${found.id}\n`);
    break;
  }

  if (conclusion === "success") {
    console.log(`::error::${values.job} succeeded without ${values.artifact}.`);
    process.exit(1);
  }

  await sleep(Number(values.interval));
}
