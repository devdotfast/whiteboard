import assert from "node:assert/strict";
import test from "node:test";
import { vetoStoppingAskAgents } from "./reviewAskShutdown.js";

test("quits without asking when no agent is working", async () => {
  const asked: unknown[] = [];
  const veto = await vetoStoppingAskAgents(
    { confirm: async (confirmation) => (asked.push(confirmation), { confirmed: false }) },
    [],
    "Quit",
  );
  assert.equal(veto, false);
  assert.deepEqual(asked, []);
});

test("keeps the window open unless the reviewer confirms stopping the agents", async () => {
  for (const confirmed of [false, true]) {
    const veto = await vetoStoppingAskAgents(
      { confirm: async () => ({ confirmed }) },
      ["Claude Code", "Codex"],
      "Quit",
    );
    assert.equal(veto, !confirmed);
  }
});
