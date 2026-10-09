import { expect, test } from "vitest";
import { createGuideDiffFile } from "../protocol/fixture";
import { rowsForFile } from "../document/rows";
import { dark } from "../theme/themes";
import { measureRows } from "./geometry";
import { planCell, targetAt, type ScopeFocus } from "./cell";

test.each(["split", "unified"] as const)("%s fold targets include neighboring blanks and share their hover bounds", layout => {
  const rows = rowsForFile(createGuideDiffFile(), 0, layout, dark, new Set());
  const geometry = measureRows(rows, 180, false, 0, 20);
  const at = (line: number, focus?: ScopeFocus) => {
    const value = rows.find(row => layout === "unified" ? row.cell?.newLineNumber === line : row.right?.lineNumber === line)!;
    const cell = (layout === "unified" ? value.cell : value.right)!;
    return planCell(cell, cell.spans, 80, layout === "unified", { theme: dark, geometry, visualLine: 0, focus });
  };
  const opener = at(3);
  const caret = opener.runs.map(run => run.text).join("").indexOf("▾");
  const fold = targetAt(opener.hits, caret)!;
  for (const x of [caret - 1, caret, caret + 1]) {
    expect(targetAt(opener.hits, x)).toBe(fold);
    expect(targetAt(opener.hovers, x)).toEqual({ id: fold, armed: true });
  }
  const body = at(4);
  const text = body.runs.map(run => run.text).join("");
  const rail = text.lastIndexOf("│");
  for (const x of [rail - 1, rail, rail + 1]) {
    expect(targetAt(body.hits, x)).toBe(fold);
    const focus = targetAt(body.hovers, x)!;
    expect(focus).toEqual({ id: fold, armed: true });
    expect(at(4, focus).runs.map(run => run.text).join("")[rail]).toBe("┃");
  }
  // Padding never steals the code or the actual rail of an outer scope.
  const firstCode = text.search(/[A-Za-z]/);
  expect(firstCode).toBeGreaterThan(rail);
  expect(targetAt(body.hits, firstCode)).toBeUndefined();
  const outer = text.indexOf("│");
  expect(targetAt(body.hits, outer)).not.toBe(fold);
  expect(targetAt(body.hovers, outer)?.id).toBe(targetAt(body.hits, outer));
});
