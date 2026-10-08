import { expect, test } from "bun:test";
import { bundledThemes, colorOf, paletteFromHelix, scopeStyle } from "./palette";
import { loadBundledTheme, parseHelixTheme } from "./themes";
const sample = `
"keyword" = { fg = "red", modifiers = ["bold"] }
"keyword.control" = { fg = "purple" }
"string" = "green"
"comment" = { fg = "#808080", modifiers = ["italic"] }
"ui.background" = { bg = "black" }
"ui.text" = { fg = "white" }
"ui.selection" = { bg = "#264f78" }
"diff.plus" = "green"
"diff.minus" = "red"

[palette]
red = "#e06c75"
purple = "#c678dd"
green = "#98c379"
black = "#282c34"
white = "#abb2bf"
`;
test("scopes fall back to their parents and colours resolve through the palette", () => {
  const theme = parseHelixTheme(sample, "sample");
  expect(scopeStyle(theme, "keyword.return")!.fg).toBe("red");
  expect(scopeStyle(theme, "keyword.control.import")!.fg).toBe("purple");
  expect(scopeStyle(theme, "string.special")!.fg).toBe("green");
  expect(scopeStyle(theme, "variable.parameter")).toBeUndefined();
  expect(colorOf(theme, "red")).toBe("#e06c75");
  expect(colorOf(theme, "#123456")).toBe("#123456");
  expect(colorOf(theme, "light-blue")).toBe("#3b8eea");
  expect(() => colorOf(theme, "chartreuse")).toThrow("unknown colour");
  const palette = paletteFromHelix(theme);
  expect(palette.bg).toBe("#282c34");
  expect(palette.isLight).toBe(false);
  expect(palette.syntax("keyword.return")).toBe("#e06c75");
  expect(palette.syntax("comment")).toBe("#808080");
  expect(palette.syntax("variable")).toBeUndefined();
  expect(palette.highlight).toBe("#264f78");
  expect(palette.addWord).not.toBe(palette.addition);
});
test("a theme without ui colours or with inheritance is rejected", () => {
  expect(() => paletteFromHelix(parseHelixTheme('"keyword" = "red"', "bare"))).toThrow("ui.background");
  expect(() => parseHelixTheme('inherits = "onedark"\n"ui.background" = { bg = "black" }', "child")).toThrow("inherits");
});
test("bundled themes load, the defaults are aliases, and captures are visibly distinct", () => {
  for (const name of Object.keys(bundledThemes)) {
    const palette = loadBundledTheme(name);
    const colours = ["keyword", "string", "comment", "type", "function"].map((c) => palette.syntax(c));
    expect(colours.every((c) => c !== undefined)).toBe(true);
    // gruvbox shares one green between strings and functions; everything else stays apart.
    expect(new Set(colours).size).toBeGreaterThanOrEqual(4);
    expect(palette.syntax("keyword.storage.modifier.ref")).toBeDefined();
  }
  expect(loadBundledTheme("default-dark").isLight).toBe(false);
  expect(loadBundledTheme("default-light").isLight).toBe(true);
  expect(loadBundledTheme("default-dark").bg).toBe(loadBundledTheme("onedark").bg);
  expect(() => loadBundledTheme("dracula")).toThrow("Unknown theme dracula");
});
test("in every bundled theme a file header stands apart from code and folds, and its path reads", () => {
  const channel = (hex: string, i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  for (const name of Object.keys(bundledThemes)) {
    const palette = loadBundledTheme(name);
    expect(palette.fileHeader).not.toBe(palette.bg);
    expect(contrast(palette.fg, palette.fileHeader)).toBeGreaterThanOrEqual(4);
    expect(contrast(palette.fileHeaderDir, palette.fileHeader)).toBeGreaterThanOrEqual(2.5);
  }
});
