import { tokens } from "@canvas/tokens.stylex";
import { EmptyState } from "@canvas/ui/empty-state";
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

  return (
    <section
      {...softwareMapRootProps(className, variant)}
      aria-label={title ?? "Software map unavailable"}
      style={style}
    >
      <EmptyState
        variant="boxed"
        xstyle={styles.unavailable}
        title="No software map for this repo yet"
        message={
          <>
            A software map adds a structural view of the systems, containers,
            and components in this repo. Author one with{" "}
            <code {...stylex.props(styles.code)}>whiteboard map</code>. The rest
            of the document works without it.
          </>
        }
      />
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

const styles = stylex.create({
  unavailable: {
    minHeight: "var(--software-map-empty-height, 520px)",
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
