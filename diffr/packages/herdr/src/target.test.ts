import { expect, test } from "bun:test";
import { addToDraft, bindTarget, type PaneInfo } from "./target";

const agent: PaneInfo = { pane_id: "pane-1", terminal_id: "terminal-1", agent: "pi", agent_status: "idle" };
test("selection is a bracketed paste request with no submit key", async () => {
  const target = await bindTarget("pane-1", "pane-2", async () => agent);
  const calls: unknown[] = [];
  await addToDraft(target, "file.ts:R1\nconst x = 1;\n", async () => agent, async params => { calls.push(params); });
  expect(calls).toEqual([{ pane_id: "pane-1", text: "file.ts:R1\nconst x = 1;\n", keys: [] }]);
});
test("a shell, replacement terminal, busy agent, and terminal escape cannot receive a draft", async () => {
  const target = await bindTarget("pane-1", "pane-2", async () => agent);
  let sends = 0;
  for (const next of [{ ...agent, agent: null }, { ...agent, terminal_id: "new" },
    { ...agent, agent_status: "working" }, { ...agent, agent_status: "blocked" }]) {
    await expect(addToDraft(target, "text", async () => next, async () => { sends++; })).rejects.toThrow();
  }
  await expect(addToDraft(target, "\x1b[201~bad", async () => agent, async () => { sends++; })).rejects.toThrow();
  expect(sends).toBe(0);
});
test("binding refuses the viewer itself and a plain shell", async () => {
  await expect(bindTarget("pane-1", "pane-1", async () => agent)).rejects.toThrow();
  await expect(bindTarget("pane-1", "pane-2", async () => ({ ...agent, agent: null }))).rejects.toThrow();
});
