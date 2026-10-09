import { expect, test } from "claude-code/testing";
import fixture from "./fixture";

const PANE = {
  plugin: "diffr",
  component: "Pane",
  requestId: "diffr",
  props: { title: "diffr", isFocused: true, bodyColumns: 90, placement: "dock", scroll: { offset: 0, bodyRows: 24 }, view: {} },
} as const;

/** The diffr on PATH: its version, and its config with the default theme. */
async function diffr($: unknown, e: { argv: readonly string[] }) {
  const stdout = e.argv[1] === "--version" ? "diffr 0.1.18\n" : JSON.stringify({ theme: { name: "default-dark", path: null } });
  return { value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
}

async function lines(ui: { drawn: (scope: { in: string }) => Promise<unknown> }, band: string) {
  const flat = (node: unknown): string =>
    typeof node === "string" ? node : (node as { children?: unknown[] }).children?.map(flat).join("") ?? "";
  const drawn = (await ui.drawn({ in: band })) as { children: unknown[] };
  return drawn.children.map(flat);
}

test("/diffr streams diffr into a pane where a click opens a file and keys switch the layout", async ($, on) => {
  let argv: readonly string[] = [];
  on("process.run", diffr);
  on("ui.open", async () => ({ value: { isPlaced: true } }));
  const copied: { text: string; surface?: string }[] = [];
  on("ui.copy", async ($, e) => {
    copied.push({ text: e.text, surface: e.surface });
    return { value: { isCopied: true } };
  });
  on("process.spawn", async function* ($, e) {
    argv = e.argv;
    // Cut mid-record, as a pipe delivers it.
    yield { stream: "stdout", text: fixture.slice(0, 1000) };
    yield { stream: "stdout", text: fixture.slice(1000) };
    return { value: { code: 0, signal: null } };
  });
  await $.command.run({ command: "diffr", args: "main 'HEAD'", presentation: { isFullscreen: true, columns: 150 } } as never);
  expect(argv.slice(-2)).toEqual(["main", "HEAD"]);

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface } as never) as never as {
      drawn: (scope: { in: string }) => Promise<unknown>;
      pointer: (event: { type: "down" | "move" | "up"; x: number; y: number; button: "left"; in: string }) => Promise<void>;
      key: (event: { key: string; in: string }) => Promise<void>;
      post: (data: unknown, scope: { in: string }) => Promise<void>;
      unmount: () => Promise<void>;
    };
    // diffr streams after the command returns.
    let shown = await lines(ui, "diff-0");
    for (let tries = 0; !shown.some((line) => line.includes("Load diff")) && tries < 50; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      shown = await lines(ui, "diff-0");
    }
    expect(shown[0]).toContain("unified");
    const load = shown.findIndex((line) => line.includes("Load diff"));
    expect(load).toBeGreaterThan(0);

    await ui.pointer({ type: "down", x: 6, y: load, button: "left", in: "diff-0" });
    shown = await lines(ui, "diff-0");
    expect(shown.some((line) => line.includes("Load diff"))).toBe(false);
    expect(shown.some((line) => line.includes('test("greets"'))).toBe(true);

    await ui.key({ key: "s", in: "diff-0" });
    expect((await lines(ui, "diff-0"))[0]).toContain("split");
    await ui.key({ key: "s", in: "diff-0" });
    expect((await lines(ui, "diff-0"))[0]).toContain("unified");

    const instance = `test-${surface}`;
    await ui.post({ instance, inputs: [[1, { press: { key: "s" } }]] }, { in: "diff-0" });
    await ui.post({ instance, inputs: [[1, { press: { key: "s" } }]] }, { in: "diff-0" });
    expect((await lines(ui, "diff-0"))[0]).toContain("split");
    await ui.post({ instance, inputs: [[1, { press: { key: "s" } }], [2, { press: { key: "s" } }]] }, { in: "diff-0" });
    expect((await lines(ui, "diff-0"))[0]).toContain("unified");

    const head = (await lines(ui, "diff-0")).findIndex((line) => line.includes("punctuation = "));
    await ui.pointer({ type: "down", x: 10, y: head, button: "left", in: "diff-0" });
    await ui.pointer({ type: "move", x: 10, y: head + 1, button: "left", in: "diff-0" });
    await ui.pointer({ type: "up", x: 10, y: head + 1, button: "left", in: "diff-0" });
    await ui.key({ key: "Y", in: "diff-0" });
    expect(copied.at(-1)?.surface).toBe(surface);
    expect(copied.at(-1)?.text).toMatch(/^Base: [a-f0-9]{40}\nHead: [a-f0-9]{40}\n\ndiff --git a\/src\/greet\.ts b\/src\/greet\.ts\nindex [a-f0-9]{40}\.\.[a-f0-9]{40} 100644\n--- a\/src\/greet\.ts\n\+\+\+ b\/src\/greet\.ts\n@@ -2,0 \+1,2 @@\n\+export function greet\(name: string, punctuation = "!"\) \{\n\+  return "hello " \+ name \+ punctuation;\n$/);
    expect((await lines(ui, "diff-1")).at(-1)!.trim()).toStartWith("Copied for agent");

    await ui.pointer({ type: "down", x: 6, y: load - 1, button: "left", in: "diff-0" });
    expect((await lines(ui, "diff-0"))[load]).toContain("Load diff");
    await ui.unmount();
  }
});

test("/diffr reports a diffr that cannot start", async ($, on) => {
  on("process.run", async () => ({ value: { exitCode: 127, stdout: "", stderr: "diffr: command not found",
    isStdoutTruncated: false, isStderrTruncated: false } }));
  const ran = await $.command.run({ command: "diffr", args: "" } as never);
  expect(ran.text).toContain("diffr: command not found");
});

test("the open tool shows a comparison in the pane, without the keyboard, and returns once diffr names it", async ($, on) => {
  on("process.run", diffr);
  const opened: unknown[] = [];
  on("ui.open", async ($, e) => {
    opened.push(e);
    return { value: { isPlaced: true } };
  });
  let argv: readonly string[] = [];
  on("process.spawn", async function* ($, e) {
    argv = e.argv;
    yield { stream: "stdout", text: fixture };
    return { value: { code: 0, signal: null } };
  });
  const called = await $.tool.call({ tool: "mcp__diffr__open", args: ["main", "HEAD"] } as never) as { result?: string; deny?: string };
  expect(called.deny).toBeUndefined();
  expect(argv.slice(-2)).toEqual(["main", "HEAD"]);
  expect(opened).toEqual([expect.objectContaining({ id: "diffr", title: "diffr main HEAD" })]);
  expect((opened[0] as { focus?: true }).focus).toBeUndefined();
  expect(called.result).toBe("Opened diffr main HEAD in a pane for the person: 2 changed files.");
  const ui = await $.ui.mount({ plugin: "diffr", component: "Pane", requestId: "diffr", surface: "terminal",
    props: { title: "diffr", isFocused: false, bodyColumns: 90, placement: "dock", scroll: { offset: 0, bodyRows: 24 }, view: {} } } as never) as never as {
      drawn: (scope: { in: string }) => Promise<unknown>; unmount: () => Promise<void> };
  const shown = await lines(ui, "diff-0");
  expect(shown.some((line) => line.includes("▾ src/greet.ts"))).toBe(true);
  expect(shown.some((line) => line.includes("export function greet"))).toBe(true);
  await ui.unmount();
});

test("the open tool reports a diffr that cannot start as an error", async ($, on) => {
  on("process.run", async () => ({ value: { exitCode: 127, stdout: "", stderr: "diffr: command not found",
    isStdoutTruncated: false, isStderrTruncated: false } }));
  const called = await $.tool.call({ tool: "mcp__diffr__open", args: [] } as never) as { result?: string; deny?: string };
  expect(called.result).toBeUndefined();
  expect(called.deny).toContain("diffr: command not found");
});

test("an older diffr is the answer to /diffr and the open tool, naming diffr upgrade", async ($, on) => {
  let spawned = false;
  on("process.run", async () => ({ value: { exitCode: 0, stdout: "diffr 0.1.17\n", stderr: "",
    isStdoutTruncated: false, isStderrTruncated: false } }));
  on("process.spawn", async function* () {
    spawned = true;
    return { value: { code: 0, signal: null } };
  });
  const ran = await $.command.run({ command: "diffr", args: "" } as never) as { text: string };
  expect(ran.text).toContain("needs diffr 0.1.18 or newer, not 0.1.17; update it with: diffr upgrade");
  const called = await $.tool.call({ tool: "mcp__diffr__open", args: [] } as never) as { result?: string; deny?: string };
  expect(called.deny).toContain("diffr upgrade");
  expect(spawned).toBe(false);
});

test("the open tool comes back once diffr names the comparison, even while diffr is still streaming", async ($, on) => {
  on("process.run", diffr);
  on("ui.open", async () => ({ value: { isPlaced: true } }));
  on("process.spawn", async function* () {
    yield { stream: "stdout", text: fixture.slice(0, fixture.indexOf("\n") + 1) };
    await new Promise(() => {});
    return { value: { code: 0, signal: null } };
  });
  const called = await Promise.race([
    $.tool.call({ tool: "mcp__diffr__open", args: ["main", "HEAD"] } as never) as Promise<{ result?: string; deny?: string }>,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the open tool waited for diffr to finish")), 2000)),
  ]);
  expect(called.result).toBe("Opened diffr main HEAD in a pane for the person: 2 changed files.");
});

test("leaving the pane, as Escape does, closes the search prompt and the picker", async ($, on) => {
  on("process.run", diffr);
  on("ui.open", async () => ({ value: { isPlaced: true } }));
  on("process.spawn", async function* () {
    yield { stream: "stdout", text: fixture };
    return { value: { code: 0, signal: null } };
  });
  await $.command.run({ command: "diffr", args: "", presentation: { isFullscreen: true, columns: 150 } } as never);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" } as never) as never as {
    drawn: (scope: { in: string }) => Promise<unknown>;
    key: (event: { key: string; ctrl?: true; in: string }) => Promise<void>;
    redraw: (props: unknown) => Promise<void>;
    unmount: () => Promise<void>;
  };
  const status = async () => (await lines(ui, "diff-1")).at(-1) ?? "";
  for (let tries = 0; !(await lines(ui, "diff-0")).some((line) => line.includes("src/greet.ts")) && tries < 50; tries++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await ui.key({ key: "/", in: "diff-0" });
  await ui.key({ key: "g", in: "diff-0" });
  expect(await status()).toStartWith("/g▏");
  await ui.redraw({ ...PANE.props, isFocused: false });
  expect(await status()).not.toContain("▏");
  await ui.redraw({ ...PANE.props, isFocused: true });
  await ui.key({ key: "p", ctrl: true, in: "diff-0" });
  expect((await lines(ui, "diff-1")).join("\n")).toContain("changed files");
  await ui.redraw({ ...PANE.props, isFocused: false });
  expect((await lines(ui, "diff-1")).join("\n")).not.toContain("changed files");
  await ui.unmount();
});

test("Enter on a selection puts a chip naming it in the prompt box, hands the keyboard back, and the prompt that names it carries its code", async ($, on) => {
  on("process.run", diffr);
  const panes: string[] = [];
  on("ui.open", async ($, e) => {
    panes.push(e.focus ? "open focused" : "open");
    return { value: { isPlaced: true } };
  });
  on("ui.close", async () => {
    panes.push("close");
    return { value: undefined };
  });
  on("process.spawn", async function* () {
    yield { stream: "stdout", text: fixture };
    return { value: { code: 0, signal: null } };
  });
  let draft = "";
  on("prompt.fill", async ($, e) => {
    draft = e.mode === "insert" ? `${draft}${e.text}` : e.text;
    return { isFilled: true };
  });
  const submitted: { text: string; context?: readonly string[] }[] = [];
  on("prompt.submit", async ($, e) => {
    submitted.push({ text: e.text, context: e.context });
    return { text: e.text, context: e.context };
  });
  await $.command.run({ command: "diffr", args: "", presentation: { isFullscreen: true, columns: 150 } } as never);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" } as never) as never as {
    drawn: (scope: { in: string }) => Promise<unknown>;
    pointer: (event: { type: "down" | "move" | "up"; x: number; y: number; button: "left"; in: string }) => Promise<void>;
    key: (event: { key: string; in: string }) => Promise<void>;
    unmount: () => Promise<void>;
  };
  let shown = await lines(ui, "diff-0");
  for (let tries = 0; !shown.some((line) => line.includes("Load diff")) && tries < 50; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    shown = await lines(ui, "diff-0");
  }
  await ui.pointer({ type: "down", x: 6, y: shown.findIndex((line) => line.includes("Load diff")), button: "left", in: "diff-0" });
  const head = (await lines(ui, "diff-0")).findIndex((line) => line.includes("punctuation = "));
  await ui.pointer({ type: "down", x: 10, y: head, button: "left", in: "diff-0" });
  await ui.pointer({ type: "move", x: 10, y: head + 1, button: "left", in: "diff-0" });
  await ui.pointer({ type: "up", x: 10, y: head + 1, button: "left", in: "diff-0" });
  expect((await lines(ui, "diff-1")).at(-1)).toContain("src/greet.ts:R1-2 · 2 lines");
  await ui.key({ key: "return", in: "diff-0" });
  expect(draft).toBe("src/greet.ts:R1-2 ");
  expect(panes).toEqual(["open focused", "close", "open"]);
  expect((await lines(ui, "diff-1")).at(-1)).toStartWith("Added src/greet.ts:R1-2 to the chat");

  await $.prompt.submit({ text: "why the default? src/greet.ts:R1-2" } as never);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.context).toHaveLength(1);
  expect(submitted[0]!.context![0]).toMatch(/calls them src\/greet\.ts:R1-2\.\nBase: [a-f0-9]{40}\nHead: [a-f0-9]{40}\n\ndiff --git a\/src\/greet\.ts b\/src\/greet\.ts\n[^]*\n\+export function greet\(name: string, punctuation = "!"\)/);
  await $.prompt.submit({ text: "and src/greet.ts:R1-2 again" } as never);
  expect(submitted[1]!.context ?? []).toHaveLength(0);
  await ui.unmount();
});
