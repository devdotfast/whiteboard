import dark from "../../review-desktop/code-oss/extensions/review-themes/themes/review-dark.json?raw";
import light from "../../review-desktop/code-oss/extensions/review-themes/themes/review-light.json?raw";
import { readSetting, writeSetting } from "./settings.js";
import { StandaloneServices } from "./standalone/browser/standaloneServices.js";
import type { StandaloneThemeService } from "./standalone/browser/standaloneThemeService.js";
/**
 * Whiteboard Dark and Light, Review Desktop's themes, following the system's choice. The colors are
 * read from the desktop's theme files; diffr’s captures use their syntax token rules.
 */
import { IStandaloneThemeService } from "./standalone/common/standaloneTheme.js";

/** The bundled TextMate scopes also work as Monaco token theme rules. */
function themeData(source: string) {
  // SAFETY: both bundled theme files define colors and scoped TextMate token settings.
  const theme = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as {
    colors: Record<string, string>;
    tokenColors: {
      scope: string | string[];
      settings: { foreground?: string; fontStyle?: string };
    }[];
  };

  return {
    colors: theme.colors,
    rules: theme.tokenColors.flatMap(({ scope, settings }) =>
      (Array.isArray(scope) ? scope : [scope]).map((token) => ({
        token,
        ...settings,
      })),
    ),
  };
}

export function applyTheme(
  root: HTMLElement,
): (mode: "auto" | "light" | "dark") => void {
  // SAFETY: StandaloneServices registers StandaloneThemeService for this id; its
  // container registration is on the implementation only.
  const themes = StandaloneServices.get(
    IStandaloneThemeService,
  ) as StandaloneThemeService;

  const darkTheme = themeData(dark);
  const lightTheme = themeData(light);
  themes.defineTheme("whiteboard-dark", {
    base: "vs-dark",
    inherit: true,
    ...darkTheme,
  });
  themes.defineTheme("whiteboard-light", {
    base: "vs",
    inherit: true,
    ...lightTheme,
  });
  themes.registerEditorContainer(root);
  const query = matchMedia("(prefers-color-scheme: dark)");

  let mode = readSetting("theme") ?? "auto";

  const apply = () => {
    const isDark = mode === "dark" || (mode === "auto" && query.matches);

    // Standalone Monaco only emits registered editor colors; the page also uses workbench colors.
    for (const [id, color] of Object.entries(
      (isDark ? darkTheme : lightTheme).colors,
    )) {
      root.style.setProperty(`--vscode-${id.replaceAll(".", "-")}`, color);
    }

    themes.setTheme(isDark ? "whiteboard-dark" : "whiteboard-light");
    root.classList.toggle("vs-dark", isDark);
    root.classList.toggle("vs", !isDark);
  };

  query.addEventListener("change", apply);
  apply();

  return (next) => {
    mode = next;
    writeSetting("theme", next);
    apply();
  };
}
