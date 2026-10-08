/** Load Helix themes (TOML keyed by tree-sitter capture names) into the painter's palette. */
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { bundledThemes, helixTheme, paletteFromHelix, type HelixTheme, type Palette } from "./palette";
import onedark from "../../themes/onedark.toml" with { type: "text" };
import onelight from "../../themes/onelight.toml" with { type: "text" };
import gruvbox from "../../themes/gruvbox.toml" with { type: "text" };
import solarized_light from "../../themes/solarized_light.toml" with { type: "text" };
export function parseHelixTheme(text: string, name: string): HelixTheme {
  return helixTheme(parse(text), name);
}
const themeSources: Record<string, string> = { onedark, onelight, gruvbox, solarized_light };
export function loadBundledTheme(name: string): Palette {
  const file = bundledThemes[name];
  if (!file) throw new Error(`Unknown theme ${name}; bundled themes: ${Object.keys(bundledThemes).join(", ")}`);
  return paletteFromHelix(parseHelixTheme(themeSources[file], name));
}
export function loadThemeFile(path: string): Palette {
  return paletteFromHelix(parseHelixTheme(readFileSync(path, "utf8"), path));
}
export interface ThemeSet {
  initial: Palette;
  dark: Palette;
  light: Palette;
}
/** Resolve the theme diffr's config names, plus the two defaults the `t` key toggles between. */
export function themesFromConfig(config: { name: string; path: string | null }): ThemeSet {
  const dark = loadBundledTheme("default-dark"), light = loadBundledTheme("default-light");
  const initial = config.path ? loadThemeFile(config.path) : loadBundledTheme(config.name);
  return { initial, dark, light };
}
/** The bundled defaults, for tests and the settings screen. */
export const dark: Palette = loadBundledTheme("default-dark");
export const light: Palette = loadBundledTheme("default-light");
