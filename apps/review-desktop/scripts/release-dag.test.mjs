import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function stepScript(workflow, name) {
  const source = readFileSync(
    new URL(`../../../.github/workflows/${workflow}.yml`, import.meta.url),
    "utf8",
  );

  const step = source.slice(source.indexOf(`      - name: ${name}\n`));

  const body = step.slice(
    step.indexOf("        run: |\n") + "        run: |\n".length,
  );

  return body
    .split("\n")
    .slice(
      0,
      body
        .split("\n")
        .findIndex((line) => line && !line.startsWith("          ")),
    )
    .map((line) => line.slice(10))
    .join("\n");
}

for (const channel of ["preview", "release"]) {
  test(`${channel} requires success from every selected platform`, () => {
    const script = stepScript(
      `review-desktop-${channel}`,
      "Require every selected build and validation",
    );

    const platforms = ["macos", "linux", "windows"];

    for (const selection of ["all", ...platforms]) {
      const baseline = Object.fromEntries(
        platforms.map((platform) => [
          platform,
          selection === "all" || selection === platform ? "success" : "skipped",
        ]),
      );

      for (const platform of platforms) {
        for (const result of ["success", "skipped", "failure", "cancelled"]) {
          const run = spawnSync("bash", ["-e", "-c", script], {
            env: {
              ...process.env,
              ...baseline,
              PLATFORMS: selection,
              [platform]: result,
            },
            encoding: "utf8",
          });

          const required = selection === "all" || selection === platform;
          assert.equal(
            run.status,
            required && result !== "success" ? 1 : 0,
            `${selection}: ${platform}=${result}\n${run.stdout}${run.stderr}`,
          );
        }
      }
    }
  });
}

for (const scenario of [
  "ready",
  "delayed",
  "failure",
  "cancelled",
  "missing",
  "api-error",
]) {
  test(`Darwin payload wait: ${scenario}`, (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "release-dag-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      path.join(dir, "gh"),
      `#!/bin/bash
if [ "$SCENARIO" = api-error ]; then exit 1; fi
if [[ "$*" = *artifacts* ]]; then
  if [ "$SCENARIO" = ready ] || { [ "$SCENARIO" = delayed ] && [ -f "$STATE" ]; }; then echo 123; fi
else
  case "$SCENARIO" in
    failure|cancelled) echo "$SCENARIO";;
    missing) echo success;;
  esac
fi
`,
      { mode: 0o755 },
    );
    writeFileSync(path.join(dir, "sleep"), '#!/bin/bash\ntouch "$STATE"\n', {
      mode: 0o755,
    });
    const output = path.join(dir, "output");

    const run = spawnSync(
      "bash",
      [
        "-e",
        "-o",
        "pipefail",
        "-c",
        stepScript("review-macos-build", "Wait for Darwin payload"),
      ],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SCENARIO: scenario,
          STATE: path.join(dir, "state"),
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: "example/repo",
          GITHUB_RUN_ID: "42",
          PAYLOAD_NAME: "payload",
        },
        timeout: 2000,
        encoding: "utf8",
      },
    );

    assert.equal(
      run.status,
      ["ready", "delayed"].includes(scenario) ? 0 : 1,
      `${run.stdout}${run.stderr}`,
    );

    if (run.status === 0)
      assert.equal(readFileSync(output, "utf8"), "artifact-id=123\n");
  });
}
