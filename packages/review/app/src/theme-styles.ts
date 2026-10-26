import * as stylex from "@stylexjs/stylex";

import { fontSize, radius, tracking } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

// Theme classes for everything below the canvas root. The palette itself is
// on the root, in global.css: only :scope reaches the @scope root.
export const themeStyles = stylex.create({
  // Custom properties every canvas surface reads. Applied wherever the
  // light class can sit on the same element: .review-app and the Desktop
  // entry host that renders home, settings and welcome.
  vars: {
    // Workbench chrome bridge. The canvas mounts straight into the Code OSS DOM
    // (no iframe), so the workbench's --vscode-* theme variables are in scope and
    // the topbar can dress itself as native chrome. Each token falls back to the
    // canvas palette so the standalone browser build is unaffected.
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
  // The palette's light-dark() values follow color-scheme; images cannot.
  light: {
    colorScheme: "light",
    "--check-mark":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 12.5 9.5 17 19 7' fill='none' stroke='%23FFFFFF' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
    "--board-grid":
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='1' cy='1' r='0.8' fill='%23E6E8EC'/></svg>\")",
  },
});
