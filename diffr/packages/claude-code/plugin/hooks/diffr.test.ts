import { expect, test } from "claude-code/testing";
import fixture from "./fixture";

const PANE = {
  plugin: "diffr",
  component: "Pane",
  requestId: "diffr",
  props: { title: "diffr", isFocused: true, bodyColumns: 90, placement: "dock", scroll: { offset: 0, bodyRows: 24 }, view: {} },
} as const;

async function lines(ui: { drawn: (scope: { in: string }) => Promise<unknown> }, band: string) {
  const flat = (node: unknown): string =>
    typeof node === "string" ? node : (node as { children?: unknown[] }).children?.map(flat).join("") ?? "";
  const drawn = (await ui.drawn({ in: band })) as { children: unknown[] };
  return drawn.children.map(flat);
}

test("/diffr streams diffr into a pane where a click opens a file and keys switch the layout", async ($, on) => {
  let argv: readonly string[] = [];
  on("process.run", async () => {
    return { value: { exitCode: 0, stdout: JSON.stringify({ theme: { name: "default-dark", path: null } }), stderr: "",
      isStdoutTruncated: false, isStderrTruncated: false } };
  });
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

    // Resent inputs apply once.
    const instance = `test-${surface}`;
    await ui.post({ instance, inputs: [[1, { press: { key: "s" } }]] }, { in: "diff-0" });
    await ui.post({ instance, inputs: [[1, { press: { key: "s" } }]] }, { in: "diff-0" });
    expect((await lines(ui, "diff-0"))[0]).toContain("split");
    await ui.post({ instance, inputs: [[1, { press: { key: "s" } }], [2, { press: { key: "s" } }]] }, { in: "diff-0" });
    expect((await lines(ui, "diff-0"))[0]).toContain("unified");

    // Dragging across code selects it, and Y copies it to the surface's clipboard for an agent.
    const head = (await lines(ui, "diff-0")).findIndex((line) => line.includes("punctuation = "));
    await ui.pointer({ type: "down", x: 10, y: head, button: "left", in: "diff-0" });
    await ui.pointer({ type: "move", x: 10, y: head + 1, button: "left", in: "diff-0" });
    await ui.pointer({ type: "up", x: 10, y: head + 1, button: "left", in: "diff-0" });
    await ui.key({ key: "Y", in: "diff-0" });
    expect(copied.at(-1)?.surface).toBe(surface);
    expect(copied.at(-1)?.text).toMatch(/^src\/greet\.ts:1-2 at \w+\n```ts\nexport function greet\(name: string, punctuation = "!"\) \{\n  return "hello " \+ name \+ punctuation;\n```$/);
    expect((await lines(ui, "diff-1")).at(-1)).toStartWith("Copied for agent");

    // Close the file again for the next surface.
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
  on("process.run", async () => ({ value: { exitCode: 0, stdout: JSON.stringify({ theme: { name: "default-dark", path: null } }),
    stderr: "", isStdoutTruncated: false, isStderrTruncated: false } }));
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

test("the open tool comes back once diffr names the comparison, even while diffr is still streaming", async ($, on) => {
  on("process.run", async () => ({ value: { exitCode: 0, stdout: JSON.stringify({ theme: { name: "default-dark", path: null } }),
    stderr: "", isStdoutTruncated: false, isStderrTruncated: false } }));
  on("ui.open", async () => ({ value: { isPlaced: true } }));
  // diffr sends the record that names the comparison, then is still working on the files.
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
  on("process.run", async () => ({ value: { exitCode: 0, stdout: JSON.stringify({ theme: { name: "default-dark", path: null } }),
    stderr: "", isStdoutTruncated: false, isStderrTruncated: false } }));
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
