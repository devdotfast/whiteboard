/** Load Helix themes (TOML keyed by tree-sitter capture names) into the painter's palette. */
/// <reference path="../assets.d.ts" />
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
  return paletteFromHelix(parseHelixTheme(themeSources[file]!, name));
}
/** The bundled defaults, for tests and the settings screen. */
export const dark: Palette = loadBundledTheme("default-dark");
export const light: Palette = loadBundledTheme("default-light");
