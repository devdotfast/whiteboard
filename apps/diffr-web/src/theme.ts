import dark from "../../review-desktop/code-oss/extensions/review-themes/themes/review-dark.json?raw";
import light from "../../review-desktop/code-oss/extensions/review-themes/themes/review-light.json?raw";
import { StandaloneServices } from "./standalone/browser/standaloneServices.js";
import type { StandaloneThemeService } from "./standalone/browser/standaloneThemeService.js";
/**
 * Whiteboard Dark and Light, Review Desktop's themes, following the system's choice. The colors are
 * read from the desktop's theme files; syntax is painted by class (styles.css), not by token rules,
 * since diffr supplies the highlights.
 */
import { IStandaloneThemeService } from "./standalone/common/standaloneTheme.js";

/** The theme files carry line comments. */
const colors = (source: string): Record<string, string> =>
  // SAFETY: both files are Review Desktop's color themes, whose `colors` maps ids to colors.
  (
    JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as {
      colors: Record<string, string>;
    }
  ).colors;

export function applyTheme(root: HTMLElement): void {
  // SAFETY: StandaloneServices registers StandaloneThemeService for this id; its
  // container registration is on the implementation only.
  const themes = StandaloneServices.get(
    IStandaloneThemeService,
  ) as StandaloneThemeService;

  themes.defineTheme("whiteboard-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: colors(dark),
  });
  themes.defineTheme("whiteboard-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: colors(light),
  });
  themes.registerEditorContainer(root);
  const query = matchMedia("(prefers-color-scheme: dark)");

  const apply = () => {
    themes.setTheme(query.matches ? "whiteboard-dark" : "whiteboard-light");
    root.classList.toggle("vs-dark", query.matches);
    root.classList.toggle("vs", !query.matches);
  };

  query.addEventListener("change", apply);
  apply();
}
