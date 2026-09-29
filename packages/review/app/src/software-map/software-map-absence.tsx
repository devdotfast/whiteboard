import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { CSSProperties, ReactElement } from "react";

import type { NormalizedSoftwareModel } from "./model";
import { softwareMapRootProps } from "./software-map-styles";

/** The CSS length for a size prop: bare numbers are pixel counts. */
export function softwareMapCssLength(value: number | string): string {
  return Number.isFinite(value) ? `${value}px` : `${value}`;
}

export function SoftwareMapUnavailable({
  title,
  height,
  className,
  variant,
}: {
  title?: string;
  height?: number | string;
  className?: string;
  variant?: "view";
}): ReactElement {
  // SAFETY: React passes "--*" keys through to style.setProperty; CSSProperties
  // only lacks an index signature for custom properties.
  const style =
    height === undefined
      ? undefined
      : ({
          "--software-map-empty-height": softwareMapCssLength(height),
        } as CSSProperties);

  const code = stylex.props(styles.code);

  return (
    <section
      {...softwareMapRootProps(className, variant)}
      aria-label={title ?? "Software map unavailable"}
      style={style}
    >
      <div {...stylex.props(styles.unavailable)}>
        <h3 {...stylex.props(styles.heading)}>
          No software map for this repo yet
        </h3>
        <p {...stylex.props(styles.paragraph)}>
          A software map adds a structural view of the systems, containers, and
          components in this repo.
        </p>
        <p {...stylex.props(styles.paragraph)}>
          Author one with <code {...code}>whiteboard map</code>.
        </p>
        <p {...stylex.props(styles.paragraph)}>
          The rest of the document works without it.
        </p>
      </div>
    </section>
  );
}

export function SoftwareMapTopologyUnavailable({
  repoSoftwareMap,
  baseSoftwareMap,
  baseRef,
  headRef,
}: {
  repoSoftwareMap: NormalizedSoftwareModel | null;
  baseSoftwareMap: NormalizedSoftwareModel | null;
  baseRef?: string;
  headRef?: string;
}): ReactElement | null {
  const missingSides = [
    ...(!baseSoftwareMap ? [softwareMapSideLabel("base", baseRef)] : []),
    ...(!repoSoftwareMap ? [softwareMapSideLabel("head", headRef)] : []),
  ];

  if (missingSides.length === 0) return null;

  return (
    <p {...stylex.props(styles.topologyUnavailable)} role="status">
      Structural diff unavailable: no software map at{" "}
      {missingSides.join(" or ")}.
    </p>
  );
}

function softwareMapSideLabel(
  side: "base" | "head",
  ref: string | undefined,
): string {
  return ref ? `${side} ${ref}` : side;
}

const inDocument = ":is(.review-document *)";

// The scratchpad's opening heading sits at the page's top padding.
const scratchpadOpening =
  ':is(.review-document[data-kind="scratchpad"] > .api-document-node:first-child *):first-child';

const styles = stylex.create({
  unavailable: {
    boxSizing: "border-box",
    display: "grid",
    placeContent: "center",
    minHeight: "var(--software-map-empty-height, 520px)",
    padding: "32px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "8px",
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    textAlign: "center",
  },
  // In a document the notice reads as the document's own heading and prose.
  heading: {
    scrollMarginTop: { default: null, [inDocument]: "24px" },
    margin: { default: "0 0 10px", [inDocument]: "30px auto 10px" },
    marginTop: { default: null, [scratchpadOpening]: 0 },
    color: tokens.ink,
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: "16px", [inDocument]: "20px" },
    fontWeight: { default: null, [inDocument]: 500 },
    lineHeight: { default: null, [inDocument]: "23px" },
  },
  paragraph: {
    maxWidth: "540px",
    margin: { default: "4px auto", [inDocument]: "14px 0" },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: "13px", [inDocument]: "15px" },
    lineHeight: { default: "20px", [inDocument]: 1.72 },
    textAlign: { default: null, [inDocument]: "left" },
  },
  code: {
    padding: { default: null, [inDocument]: "2px 5px" },
    borderRadius: { default: null, [inDocument]: "3px" },
    backgroundColor: { default: null, [inDocument]: tokens.well },
    color: tokens.ink,
    fontFamily: { default: null, [inDocument]: tokens.fontMono },
    fontSize: { default: null, [inDocument]: "0.85em" },
    fontWeight: 700,
  },
  topologyUnavailable: {
    flex: "none",
    margin: 0,
    padding: "7px 12px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.tray,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: "11px",
    lineHeight: "16px",
  },
});
