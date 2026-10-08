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

    // Dragging the code pans it.
    const code = shown.findIndex((line) => line.includes("export function greet"));
    await ui.pointer({ type: "down", x: 40, y: code, button: "left", in: "diff-0" });
    await ui.pointer({ type: "move", x: 30, y: code, button: "left", in: "diff-0" });
    await ui.pointer({ type: "up", x: 30, y: code, button: "left", in: "diff-0" });
    expect((await lines(ui, "diff-0"))[code]).not.toContain("export function");
    await ui.key({ key: "H", in: "diff-0" });

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
