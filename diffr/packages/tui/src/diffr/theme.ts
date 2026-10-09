import { readFileSync } from "node:fs";
import { paletteFromHelix, type Palette } from "@diffr/viewer/theme/palette";
import { loadBundledTheme, parseHelixTheme } from "@diffr/viewer/theme/themes";
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
