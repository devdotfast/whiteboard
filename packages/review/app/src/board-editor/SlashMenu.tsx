import { fontSize, layer, leading, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { menuStyles } from "@canvas/ui/menu";
import { surfaceStyles } from "@canvas/ui/surface";
import * as stylex from "@stylexjs/stylex";
import type { EditorView } from "@tiptap/pm/view";
import type { ReactElement } from "react";

import { type SlashState, applySlashItem } from "./slash";

// The "/" menu's list, under the slash: the surface and rows of the canvas's
// other menus, with each item's Markdown shortcut faint on the right.

export function SlashMenu({
  state,
  view,
}: {
  state: Extract<SlashState, { open: true }>;
  view: EditorView;
}): ReactElement {
  // Placed in the editor's own box, which scrolls with the page.
  const at = view.coordsAtPos(state.from);
  const box = view.dom.getBoundingClientRect();
  // Rows are 24px with 2px between, inside 4px of padding; it opens above
  // the line when there is no room below.
  const height = state.items.length * 26 + 8;

  const top =
    at.bottom + 6 + height > window.innerHeight
      ? at.top - 6 - height
      : at.bottom + 6;

  return (
    <div
      role="listbox"
      aria-label="Blocks"
      {...stylex.props(surfaceStyles.popover, styles.menu)}
      style={{ left: at.left - box.left - 8, top: top - box.top }}
    >
      {state.items.map((item, index) => (
        <div
          key={item.label}
          role="option"
          tabIndex={-1}
          aria-selected={index === state.index}
          {...stylex.props(
            menuStyles.item,
            styles.item,
            index === state.index && menuStyles.itemHighlighted,
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            applySlashItem(view, item);
          }}
        >
          {item.label}
          <span {...stylex.props(styles.shortcut)}>{item.shortcut}</span>
        </div>
      ))}
    </div>
  );
}

const styles = stylex.create({
  menu: {
    position: "absolute",
    zIndex: layer.sticky,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    width: "232px",
    padding: space.s4,
  },
  item: {
    justifyContent: "space-between",
    minHeight: "24px",
    padding: `3px ${space.s8}`,
    fontSize: fontSize.ui,
    lineHeight: leading.px18,
  },
  shortcut: {
    color: tokens.inkFaint,
    fontSize: fontSize.small,
    lineHeight: leading.px14,
  },
});
