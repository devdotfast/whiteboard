import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The palette for everything below the canvas root. The root's own box and
// dark tokens stay in global.css: only :scope reaches the @scope root.
export const themeStyles = stylex.create({
  // Custom properties every canvas surface reads. Applied wherever the
  // light class can sit on the same element: .review-app and the Desktop
  // entry host that renders home, settings and welcome.
  vars: {
    "--tutorial-ring": "color-mix(in srgb, var(--accent) 82%, white)",
    "--tutorial-ring-glow":
      "color-mix(in srgb, var(--accent) 44%, transparent)",
    "--tutorial-guide-bg":
      "color-mix(in srgb, var(--surface-raised) 96%, transparent)",
    "--tutorial-guide-border":
      "color-mix(in srgb, var(--tutorial-ring) 48%, var(--rule-soft))",
    // Workbench chrome bridge. The canvas mounts straight into the Code OSS DOM
    // (no iframe), so the workbench's --vscode-* theme variables are in scope and
    // the topbar can dress itself as native chrome. Each token falls back to the
    // canvas palette so the standalone browser build is unaffected. These live on
    // .review-app rather than .review-canvas-root because the light palette is a
    // class on this same element -- a custom property is substituted where it is
    // declared, so declaring them further up would freeze the dark values.
    // The workbench has no font custom property to bridge to -- it hardcodes a
    // stack per platform and per language -- so Desktop's review.css publishes
    // --review-chrome-font; the browser build keeps the canvas's mono face.
    "--chrome-font": "var(--review-chrome-font, var(--font-mono))",
    // The workbench publishes a font-weight ramp, so the weights bridge like the
    // color tokens below. The sizes are fixed at the end of this rule.
    "--chrome-font-weight": "var(--vscode-fontWeight-regular, 400)",
    "--chrome-font-weight-strong": "var(--vscode-fontWeight-semiBold, 600)",
    // One tracking value, used only by the uppercase micro-labels. The
    // sentence-case buttons stay untracked, as the workbench's own buttons are.
    "--chrome-tracking": "0.04em",
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
    "--chrome-control-radius": "6px",
    "--chrome-font-size": "12px",
    "--chrome-font-size-small": "11px",
    "--chrome-hover-bg": "var(--well)",
    "--chrome-border": "var(--rule)",
    "--wb-caps": "0.08em",
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
    fontFamily: tokens.fontMono,
  },
  light: {
    "--ghost": "#cdd1d8",
    "--well": "#e9ebef",
    "--raised": "#ffffff",
    "--tray": "#f3f4f6",
    "--chevron-down":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 4.25 6 8l3.5-3.75' fill='none' stroke='%239AA0AB' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
    "--check-mark":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M2 5.2 4.2 7.4 8 3.2' fill='none' stroke='%23FFFFFF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
    "--marker-tint": "rgba(43, 85, 230, 0.08)",
    "--marker-glow": "rgba(43, 85, 230, 0.22)",
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
    "--selection": "var(--accent)",
    "--selection-shadow": "color-mix(in srgb, var(--accent) 40%, transparent)",
    "--tutorial-ring": "color-mix(in srgb, var(--accent) 86%, #14213d)",
    "--tutorial-ring-glow":
      "color-mix(in srgb, var(--accent) 34%, transparent)",
    "--tutorial-guide-bg":
      "color-mix(in srgb, var(--surface-raised) 98%, white)",
    "--tutorial-guide-border":
      "color-mix(in srgb, var(--tutorial-ring) 42%, var(--rule-soft))",
    "--map-storage-border": "#4a7685",
    "--vscode-focusBorder": "transparent",
    "--vscode-list-focusOutline": "transparent",
    "--vscode-list-focusAndSelectionOutline": "transparent",
    "--vscode-list-inactiveFocusOutline": "transparent",
    "--vscode-inputOption-activeBorder": "transparent",
    "--accent": "#2b55e6",
    "--accent-soft": "#eef2ff",
    "--on-accent": "#ffffff",
    "--on-accent-wash": "rgba(255, 255, 255, 0.34)",
    "--rpc": "#2b55e6",
    "--text-selection-bg": "rgba(43, 85, 230, 0.16)",
    "--text-selection-color": "var(--ink)",
    "--canvas-grid": "#e6e8ec",
    "--minimap-mask": "rgba(255, 255, 255, 0.72)",
    "--minimap-node": "#b9bec7",
    "--minimap-node-selected": "transparent",
    "--edge-muted": "#9aa0ab",
    "--change-added": "#1b9a57",
    "--change-removed": "#d8402c",
    "--change-modified": "#c98a0b",
    "--diff-added": "#1b9a57",
    "--diff-added-bg": "#eef7f2",
    "--diff-modified": "#c98a0b",
    "--diff-modified-bg": "#fbf5e8",
    "--diff-removed": "#d8402c",
    "--diff-removed-bg": "#fcefed",
    "--shadow-color": "rgba(21, 24, 30, 0.08)",
    "--shadow-color-strong": "rgba(21, 24, 30, 0.1)",
    "--backdrop": "rgba(21, 24, 30, 0.26)",
    "--accent-shadow": "rgba(43, 85, 230, 0.08)",
    "--accent-stripe": "rgba(43, 85, 230, 0.12)",
    "--accent-wash": "rgba(43, 85, 230, 0.08)",
    "--accent-outline": "rgba(43, 85, 230, 0.32)",
    "--link-open-wash": "rgba(43, 85, 230, 0.12)",
    "--rpc-wash": "rgba(43, 85, 230, 0.08)",
    "--toc-inner-shadow": "rgba(21, 24, 30, 0.02)",
    "--review-home-bg": "var(--bg)",
    "--review-home-rule": "var(--rule)",
    "--review-home-rule-soft": "var(--rule-soft)",
    "--review-home-meta": "#5d6472",
    "--review-home-view-toggle-active-border": "#d8dbe1",
    "--review-home-view-toggle-active-bg": "#ffffff",
    "--review-home-view-toggle-shadow": "rgba(21, 24, 30, 0.06)",
    "--review-home-view-toggle-highlight": "rgba(255, 255, 255, 0.8)",
    // Code (Whiteboard Light): petrol and navy for types and functions, sepia
    // strings, plum numbers; inserted and deleted sit one step deeper than the
    // change colors so they hold AA as text on white.
    "--syntax-comment": "#6b7382",
    "--syntax-type": "#0c6e8e",
    "--syntax-function": "#1f3f99",
    "--syntax-string": "#8a5a1c",
    "--syntax-number": "#8b3f8a",
    "--syntax-operator": "#5d6472",
    "--syntax-inserted": "#167a47",
    "--syntax-deleted": "#c93a27",
  },
});
