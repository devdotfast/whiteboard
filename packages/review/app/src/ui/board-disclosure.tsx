import { boardRowMarker, chevronMarker } from "@canvas/markers.stylex";
import { radius, space } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { buttonStyles } from "./button";
import { DisclosureChevron, disclosureStyles } from "./disclosure";
import { focusStyles } from "./focus";

/** A stable lane: expansion never moves the board title or opens it. */
export function BoardDisclosure({
  title,
  expanded,
  onToggle,
}: {
  title: string;
  expanded?: boolean;
  onToggle?(): void;
}) {
  if (expanded === undefined)
    return <span {...stylex.props(boardControlStyles.slot)} />;

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
      {...stylex.props(
        chevronMarker,
        focusStyles.ringInset,
        buttonStyles.reset,
        disclosureStyles.toggle,
        boardControlStyles.slot,
        boardControlStyles.reveal,
        boardControlStyles.toggle,
        expanded && boardControlStyles.expanded,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
    >
      <DisclosureChevron />
    </button>
  );
}

export const boardControlStyles = stylex.create({
  slot: { flexShrink: 0, display: "flex", width: space.s16, height: space.s16 },
  toggle: { padding: 0, borderRadius: radius.small },
  reveal: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", boardRowMarker)]: 1,
      [stylex.when.ancestor(":focus-within", boardRowMarker)]: 1,
    },
  },
  expanded: { opacity: 1 },
});
