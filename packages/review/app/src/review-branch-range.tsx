import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { copyText } from "./copy-text";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

const fullHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

/** A branch name as is; a full commit hash cut to its first eight digits. */
export function shortRef(ref: string): string {
  return fullHash.test(ref) ? ref.slice(0, 8) : ref;
}

/** A head that is the checkout's working files, not a commit. */
export const WORKING_TREE = Symbol("working tree");

/**
 * The pinned commit range as two copyable chips, `base ← head`: the arrow
 * points from the head commit into the base it is compared against. A
 * working-tree head has no commit to copy, so it is a plain label.
 */
export function ReviewBranchRange({
  baseRef,
  headRef,
}: {
  baseRef: string;
  headRef: string | typeof WORKING_TREE;
}): ReactElement {
  const [copied, setCopied] = useState<"base" | "head" | null>(null);

  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async (side: "base" | "head", ref: string) => {
    if (!(await copyText(ref))) return;
    clearTimeout(resetTimer.current);
    setCopied(side);
    resetTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div
      {...stylex.props(styles.range)}
      role="group"
      aria-label={`Session commits: base ${shortRef(baseRef)}, head ${
        headRef === WORKING_TREE ? "working tree" : shortRef(headRef)
      }`}
    >
      <BranchRef
        label="base"
        name={baseRef}
        copied={copied === "base"}
        onCopy={() => void copy("base", baseRef)}
      />
      <span {...stylex.props(styles.arrow)} aria-hidden="true">
        ←
      </span>
      {headRef === WORKING_TREE ? (
        <WorkingTreeRef />
      ) : (
        <BranchRef
          label="head"
          name={headRef}
          copied={copied === "head"}
          onCopy={() => void copy("head", headRef)}
        />
      )}
    </div>
  );
}

function BranchRef({
  label,
  name,
  copied,
  onCopy,
}: {
  label: "base" | "head";
  name: string;
  copied: boolean;
  onCopy: () => void;
}): ReactElement {
  const tooltip = useTooltip(`${label} ${name}`, { detail: "Click to copy" });

  return (
    <button
      type="button"
      {...stylex.props(
        styles.chip,
        styles.copy,
        label === "base" && styles.copyBase,
      )}
      data-side={label}
      data-copied={copied || undefined}
      aria-label={`Copy ${label} commit hash ${name}`}
      ref={tooltip}
      onClick={onCopy}
    >
      <span {...stylex.props(styles.name, copied && styles.nameCopied)}>
        {shortRef(name)}
      </span>
      <span {...stylex.props(styles.feedback)} role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

function WorkingTreeRef(): ReactElement {
  const tooltip = useTooltip<HTMLSpanElement>("head Working tree", {
    detail: "Saved files in the checkout, including uncommitted changes",
  });

  return (
    <span
      {...stylex.props(styles.chip, styles.worktree)}
      data-side="head"
      ref={tooltip}
    >
      Working tree
    </span>
  );
}

const styles = stylex.create({
  range: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "6px",
    color: "inherit",
    whiteSpace: "nowrap",
  },
  // Each pinned commit is a small mono chip that copies its full hash; a
  // working-tree head wears the same chip but has nothing to copy.
  chip: {
    position: "relative",
    display: "inline-flex",
    minWidth: 0,
    alignItems: "center",
    margin: 0,
    padding: "0 6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "4px",
    backgroundColor: tokens.tray,
    color: tokens.ink,
    font: `12px/18px ${tokens.fontMono}`,
    cursor: "pointer",
  },
  copy: {
    backgroundColor: {
      default: tokens.tray,
      ":hover": tokens.chromeHoverBg,
      ":focus-visible": tokens.chromeHoverBg,
    },
    outline: { default: null, ":hover": "none", ":focus-visible": "none" },
    borderColor: { default: tokens.rule, ":focus-visible": tokens.accent },
  },
  copyBase: {
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
  },
  worktree: {
    cursor: "default",
  },
  name: {
    maxWidth: "150px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nameCopied: {
    visibility: "hidden",
  },
  feedback: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
  },
  arrow: {
    color: tokens.inkFaint,
  },
});
