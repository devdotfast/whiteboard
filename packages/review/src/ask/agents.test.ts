import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { askAgentTakesMcp } from "./agents.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-ask-agents-"));
  vi.stubEnv("HOME", root);
  vi.stubEnv("PATH", "/usr/bin:/bin");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it.skipIf(process.platform === "win32")(
  "gives MCP to a Pi found, and run, only on the PATH it is handed",
  async () => {
    const bin = path.join(root, "login-bin");
    await mkdir(bin);
    await writeFile(
      path.join(bin, "wbtest-node"),
      '#!/bin/sh\nexec /bin/sh "$@"\n',
      { mode: 0o755 },
    );
    await writeFile(
      path.join(bin, "pi"),
      "#!/usr/bin/env wbtest-node\necho 0.99.0\n",
      { mode: 0o755 },
    );

    expect(await askAgentTakesMcp("pi", { PATH: `${bin}:/usr/bin:/bin` })).toBe(
      true,
    );
    expect(await askAgentTakesMcp("pi")).toBe(false);
  },
);
