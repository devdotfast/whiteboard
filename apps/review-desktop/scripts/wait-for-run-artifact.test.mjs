import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const SCRIPT = new URL("./wait-for-run-artifact.mjs", import.meta.url).pathname;

// Each scenario answers polls in order; the last answer repeats.
const SCENARIOS = {
  ready: { exit: 0, polls: [{ artifact: true }] },
  delayed: { exit: 0, polls: [{}, { artifact: true }] },
  "api-error": { exit: 0, polls: [{ status: 502 }, { artifact: true }] },
  failure: { exit: 1, polls: [{ conclusion: "failure" }] },
  cancelled: { exit: 1, polls: [{ conclusion: "cancelled" }] },
  missing: { exit: 1, polls: [{ conclusion: "success" }] },
};

for (const [scenario, { exit, polls }] of Object.entries(SCENARIOS)) {
  test(`waits for a run artifact: ${scenario}`, async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "wait-for-run-artifact-"));
    let poll = 0;
    let answer;

    const server = createServer((request, response) => {
      if (request.url.includes("/jobs?")) answer = polls[Math.min(poll++, polls.length - 1)];

      if (answer.status) return response.writeHead(answer.status).end();
      response.setHeader("content-type", "application/json");

      response.end(
        JSON.stringify(
          request.url.includes("/jobs?")
            ? {
                jobs: [
                  { name: "Other", conclusion: "failure" },
                  { name: "build / Publish", conclusion: answer.conclusion ?? null },
                ],
              }
            : {
                artifacts: answer.artifact
                  ? [
                      { id: 7, name: "pin", expired: false },
                      { id: 9, name: "pin", expired: false },
                      { id: 11, name: "pin", expired: true },
                    ]
                  : [],
              },
        ),
      );
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const output = path.join(dir, "output");

    const child = spawn(
      process.execPath,
      [SCRIPT, "--job", "Publish", "--artifact", "pin", "--interval", "1"],
      {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_REPOSITORY: "example/repo",
          GITHUB_RUN_ID: "42",
          GITHUB_OUTPUT: output,
          GH_TOKEN: "token",
        },
      },
    );

    const status = await new Promise((resolve) => child.on("exit", resolve));

    assert.equal(status, exit);

    if (exit === 0) assert.equal(readFileSync(output, "utf8"), "artifact-id=9\n");
  });
}
