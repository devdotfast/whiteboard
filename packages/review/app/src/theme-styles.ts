import * as stylex from "@stylexjs/stylex";

import { fontSize, radius, tracking } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

// The palette for everything below the canvas root. The root's own box and
// dark tokens stay in global.css: only :scope reaches the @scope root.
export const themeStyles = stylex.create({
  // Custom properties every canvas surface reads. Applied wherever the
  // light class can sit on the same element: .review-app and the Desktop
  // entry host that renders home, settings and welcome.
  vars: {
    // Workbench chrome bridge. The canvas mounts straight into the Code OSS DOM
    // (no iframe), so the workbench's --vscode-* theme variables are in scope and
    // the topbar can dress itself as native chrome. Each token falls back to the
    // canvas palette so the standalone browser build is unaffected. These live on
    // .review-app rather than .review-canvas-root because the light palette is a
    // class on this same element -- a custom property is substituted where it is
    // declared, so declaring them further up would freeze the dark values.
    // The workbench has no font custom property to bridge to -- it hardcodes a
    // stack per platform and per language -- so Desktop's review.css publishes
    // --review-chrome-font; the browser build uses the canvas's own Inter.
    "--chrome-font": "var(--review-chrome-font, var(--font-sans))",
    // The workbench publishes a font-weight ramp, so the weights bridge like the
    // color tokens below. The sizes are fixed at the end of this rule.
    "--chrome-font-weight": "var(--vscode-fontWeight-regular, 400)",
    "--chrome-font-weight-strong": "var(--vscode-fontWeight-semiBold, 600)",
    // One tracking value, used only by the uppercase micro-labels. The
    // sentence-case buttons stay untracked, as the workbench's own buttons are.
    "--chrome-tracking": tracking.chrome,
    "--chrome-icon-size": "14px",
    "--chrome-fg": "var(--vscode-foreground, var(--ink))",
    // --ink-muted already bridges descriptionForeground, so this is just an alias.
    "--chrome-fg-muted": "var(--ink-muted)",
    "--chrome-icon-fg": "var(--vscode-icon-foreground, var(--ink-muted))",
    "--chrome-active-border":
      "var(--vscode-panelTitle-activeBorder, var(--accent))",
    "--trees-bg-override": "var(--bg)",
    "--trees-fg-override": "var(--ink-muted)",
    "--trees-fg-muted-override": "var(--ink-faint)",
    "--trees-border-color-override": "var(--transparent)",
    "--trees-selected-bg-override": "var(--transparent)",
    "--trees-selected-fg-override": "var(--accent)",
    "--trees-selected-focused-border-color-override": "var(--transparent)",
    "--trees-bg-muted-override": "var(--bg)",
    "--trees-input-bg-override": "var(--transparent)",
    "--trees-search-bg-override": "var(--transparent)",
    "--trees-search-fg-override": "var(--ink)",
    "--trees-status-added-override": "var(--ink-muted)",
    "--trees-status-deleted-override": "var(--ink-muted)",
    "--trees-status-modified-override": "var(--ink-muted)",
    "--trees-status-renamed-override": "var(--ink-muted)",
    "--trees-git-added-color-override": "var(--ink-muted)",
    "--trees-git-deleted-color-override": "var(--ink-muted)",
    "--trees-git-modified-color-override": "var(--ink-muted)",
    "--trees-git-renamed-color-override": "var(--ink-muted)",
    "--diffs-bg-context-gutter-override": "var(--surface)",
    "--diffs-bg-separator-override": "var(--tray)",
    "--diffs-bg-hover-override": "var(--tray)",
    "--diagram-border": "var(--rule)",
    "--diagram-surface": "var(--surface)",
    "--diagram-canvas-bg": "var(--bg)",
    "--review-page-top": "20px",
    // Chrome metrics. One size for every control in the topbar, the view
    // switcher included; two type sizes: the label size for anything you read,
    // the small size for badges and tallies.
    "--chrome-control-height": "24px",
    "--chrome-control-radius": radius.control,
    "--chrome-font-size": fontSize.body,
    "--chrome-font-size-small": fontSize.small,
    "--chrome-hover-bg": "var(--well)",
    "--chrome-border": "var(--rule)",
  },
  app: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 0 0",
    height: "100%",
    minHeight: "0",
    overflow: "hidden",
    color: tokens.ink,
    backgroundColor: tokens.bg,
    colorScheme: "dark",
    fontFamily: tokens.chromeFont,
  },
  light: {
    "--ghost": "#cdd1d8",
    "--well": "#e9ebef",
    "--raised": "#ffffff",
    "--tray": "#f3f4f6",
    "--tray-raised": "color-mix(in srgb, var(--ink) 6%, var(--tray))",
    "--chevron-down":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 8.5 12 16l7-7.5' fill='none' stroke='%239AA0AB' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
    "--check-mark":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 12.5 9.5 17 19 7' fill='none' stroke='%23FFFFFF' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
    "--marker-tint": "color-mix(in srgb, var(--accent) 8%, transparent)",
    "--marker-glow": "color-mix(in srgb, var(--accent) 22%, transparent)",
    "--agent-1": "#7a4fd6",
    "--agent-1-tint": "rgba(122, 79, 214, 0.08)",
    "--agent-1-glow": "rgba(122, 79, 214, 0.22)",
    "--agent-2": "#0f8a86",
    "--agent-2-tint": "rgba(15, 138, 134, 0.08)",
    "--agent-2-glow": "rgba(15, 138, 134, 0.22)",
    "--board-grid":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='1' cy='1' r='0.8' fill='%23E6E8EC'/></svg>\")",
    colorScheme: "light",
    "--transparent": "transparent",
    // The neutrals bridged on .review-canvas-root are re-declared here with
    // light fallbacks. They cannot simply be inherited: this class sits on a
    // descendant of the root, so a bare `--bg: #ffffff` would beat the bridged
    // value and the session view would disagree with the workbench on any light
    // theme whose editor background is not pure white (Solarized Light, etc.).
    "--bg": "var(--vscode-editor-background, #ffffff)",
    "--surface": "var(--vscode-editor-background, #ffffff)",
    "--surface-raised": "var(--vscode-editorWidget-background, #ffffff)",
    "--control-bg": "var(--vscode-input-background, #e9ebef)",
    "--ink": "var(--vscode-editor-foreground, #15181e)",
    "--ink-muted": "var(--vscode-descriptionForeground, #5d6472)",
    "--ink-faint": "var(--vscode-disabledForeground, #9aa0ab)",
    "--review-scrollbar-thumb":
      "var(--vscode-scrollbarSlider-background, color-mix(in srgb, #9aa0ab 45%, transparent))",
    "--review-scrollbar-thumb-hover":
      "var(--vscode-scrollbarSlider-hoverBackground, #9aa0ab)",
    "--review-scrollbar-thumb-active":
      "var(--vscode-scrollbarSlider-activeBackground, #5d6472)",
    "--rule": "var(--vscode-panel-border, #d8dbe1)",
    "--rule-soft": "var(--vscode-editorWidget-border, #b9bec7)",
    "--toolbar-hover-bg": "var(--vscode-toolbar-hoverBackground, #e9ebef)",
    "--input-option-active-bg":
      "var(--vscode-inputOption-activeBackground, #f3f4f6)",
    "--input-option-active-fg":
      "var(--vscode-inputOption-activeForeground, #15181e)",
    "--selection": "var(--accent)",
    "--selection-shadow": "color-mix(in srgb, var(--accent) 40%, transparent)",
    "--map-storage-border": "#4a7685",
    "--vscode-focusBorder": "transparent",
    "--vscode-list-focusOutline": "transparent",
    "--vscode-list-focusAndSelectionOutline": "transparent",
    "--vscode-list-inactiveFocusOutline": "transparent",
    "--vscode-inputOption-activeBorder": "transparent",
    "--accent": "var(--review-accent, #2b55e6)",
    "--accent-soft": "color-mix(in srgb, var(--accent) 8%, var(--bg))",
    "--on-accent": "var(--review-on-accent, #ffffff)",
    "--on-accent-wash": "color-mix(in srgb, var(--on-accent) 34%, transparent)",
    "--rpc": "var(--accent)",
    "--text-selection-bg": "color-mix(in srgb, var(--accent) 16%, transparent)",
    "--text-selection-color": "var(--ink)",
    "--canvas-grid": "#e6e8ec",
    "--minimap-mask": "rgba(255, 255, 255, 0.72)",
    "--minimap-node": "#b9bec7",
    "--minimap-node-selected": "transparent",
    "--edge-muted": "#9aa0ab",
    "--change-added": "var(--review-success, #1b9a57)",
    "--change-removed": "var(--review-danger, #d8402c)",
    "--change-modified": "var(--review-warning, #c98a0b)",
    "--merged": "#8250df",
    "--warning-wash":
      "color-mix(in srgb, var(--change-modified) 10%, transparent)",
    "--warning-outline":
      "color-mix(in srgb, var(--change-modified) 24%, transparent)",
    "--on-warning": "#4a3514",
    "--diff-added": "var(--change-added)",
    "--diff-added-bg": "color-mix(in srgb, var(--diff-added) 8%, var(--bg))",
    "--diff-modified": "var(--change-modified)",
    "--diff-modified-bg":
      "color-mix(in srgb, var(--diff-modified) 8%, var(--bg))",
    "--diff-removed": "var(--change-removed)",
    "--diff-removed-bg":
      "color-mix(in srgb, var(--diff-removed) 8%, var(--bg))",
    "--shadow-color": "rgba(21, 24, 30, 0.08)",
    "--shadow-color-strong": "rgba(21, 24, 30, 0.1)",
    "--backdrop": "rgba(21, 24, 30, 0.26)",
    "--accent-shadow": "color-mix(in srgb, var(--accent) 8%, transparent)",
    "--accent-stripe": "color-mix(in srgb, var(--accent) 12%, transparent)",
    "--accent-wash": "color-mix(in srgb, var(--accent) 8%, transparent)",
    "--accent-outline": "color-mix(in srgb, var(--accent) 32%, transparent)",
    "--link-open-wash": "color-mix(in srgb, var(--accent) 12%, transparent)",
    "--rpc-wash": "color-mix(in srgb, var(--rpc) 8%, transparent)",
    // Code (Whiteboard Light): petrol and navy for types and functions, sepia
    // strings, plum numbers; inserted and deleted sit one step deeper than the
    // change colors so they hold AA as text on white.
    "--syntax-comment": "var(--review-syntax-comment, #6b7382)",
    "--syntax-keyword": "var(--review-syntax-keyword, var(--accent))",
    "--syntax-type": "var(--review-syntax-type, #0c6e8e)",
    "--syntax-function": "var(--review-syntax-function, #1f3f99)",
    "--syntax-string": "var(--review-syntax-string, #8a5a1c)",
    "--syntax-number": "var(--review-syntax-number, #8b3f8a)",
    "--syntax-operator": "var(--review-syntax-operator, #5d6472)",
    "--syntax-inserted": "#167a47",
    "--syntax-deleted": "#c93a27",
  },
});
