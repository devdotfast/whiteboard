import { expect, test } from "vitest";
import { createTestDiffFile, startFor, withIdenticalLines } from "./protocol/fixture";
import { DiffStore } from "./protocol/store";
import { visibleRows } from "./viewport/geometry";
import type { DiffFile } from "./protocol/wire";
import { dark } from "./theme/themes";
import { Viewer, type KeyPress } from "./viewer";

const named = (path: string) => {
  const file = withIdenticalLines(createTestDiffFile(), 30);
  file.file.lhs!.path = file.file.rhs!.path = path;
  return file;
};

function open(files: DiffFile[]) {
  const store = new DiffStore();
  store.accept(startFor(files));
  files.forEach((file) => store.accept(file));
  const viewer = new Viewer(store, dark, 100);
  viewer.lay({ columns: 160, rows: 6 });
  const press = (...keys: (string | KeyPress)[]) =>
    keys.forEach((key) => viewer.press(typeof key === "string" ? { key } : key));
  const topFile = () => {
    const at = viewer.lay({ columns: 160, rows: 6 });
    return visibleRows(at.geometry, at.top, 1)[0]!.row;
  };
  return { viewer, press, topFile };
}

const files = () => [named("src/model/store.ts"), named("src/model/selection.ts"), named("src/protocol/wire.ts"), named("docs/notes.md")];

test("Ctrl-P lists every changed file, and letters in order narrow it, best match first", () => {
  const { viewer, press } = open(files());
  press({ key: "p", ctrl: true });
  expect(viewer.picking).toBe(true);
  expect(viewer.pickerState()!.picks.map((pick) => pick.path)).toEqual(
    ["docs/notes.md", "src/model/selection.ts", "src/model/store.ts", "src/protocol/wire.ts"]);
  press("s", "t", "o");
  const picks = viewer.pickerState()!.picks;
  expect(picks[0]!.path).toBe("src/model/store.ts");
  expect(picks.map((pick) => pick.path)).not.toContain("docs/notes.md");
  expect(picks[0]!.indexes.map((index) => picks[0]!.path[index]).join("")).toBe("sto");
});

test("Enter goes to the file under the cursor and closes the picker; Escape closes it where it was", () => {
  const { viewer, press, topFile } = open(files());
  press({ key: "p", ctrl: true }, "w", "i", "r", "e", "return");
  expect(viewer.picking).toBe(false);
  expect(topFile().key).toBe(`${2}:header`);
  press({ key: "p", ctrl: true }, "down", { key: "n", ctrl: true }, { key: "p", ctrl: true });
  expect(viewer.pickerState()!.cursor).toBe(1);
  press("escape");
  expect(viewer.picking).toBe(false);
  expect(topFile().key).toBe(`${2}:header`);
});

test("viewed files sink below the rest of the matches", () => {
  const { viewer, press } = open(files());
  viewer.toggleViewedFile(0);
  press({ key: "p", ctrl: true }, "s");
  expect(viewer.pickerState()!.picks.at(-1)!.path).toBe("src/model/store.ts");
});

test("⌘P opens the picker too, where the terminal passes Cmd through", () => {
  const { viewer, press } = open(files());
  press({ key: "p", meta: true });
  expect(viewer.picking).toBe(true);
});

test("]c and [c go to the next and previous change, as in vim; ] or [ with anything else does nothing", () => {
  const changed = ["a.ts", "b.ts", "c.ts", "d.ts"].map((path) => {
    const file = createTestDiffFile();
    file.file.lhs!.path = file.file.rhs!.path = path;
    return file;
  });
  const { viewer, press, topFile } = open(changed);
  press("]", "c");
  const first = topFile();
  expect(first.hunkStart).toBe(true);
  press("]", "c");
  const second = topFile();
  expect(second.hunkStart).toBe(true);
  expect(second.key).not.toBe(first.key);
  press("[", "c");
  expect(topFile().key).toBe(first.key);
  press("]", "j");
  expect(topFile().key).toBe(first.key);
  expect(viewer.chording).toBe(false);
});
