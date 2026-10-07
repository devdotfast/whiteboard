import { IconButton } from "@canvas/ui/button";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

import { CheckIcon, CopyIcon as CopyGlyph } from "./icons";
import { useTooltip } from "./use-tooltip";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    // The workbench denies DOM clipboard permission requests.
  }

  const active = document.activeElement;
  const selection = document.getSelection();

  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];

  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.style.position = "fixed";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();
  let copied = false;

  try {
    copied = document.execCommand("copy");
  } catch {
    // The caller keeps its default label when the copy fails.
  }

  scratch.remove();

  if (active instanceof HTMLElement) active.focus();

  if (selection && ranges.length) {
    selection.removeAllRanges();

    for (const range of ranges) selection.addRange(range);
  }

  return copied;
}

/** The prompt cards' copy glyph. */
export function CopyIcon() {
  return (
    <svg {...stylex.props(styles.icon)} viewBox="0 0 12 12" aria-hidden="true">
      <rect
        {...stylex.props(styles.stroke)}
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="1"
      />
      <path
        {...stylex.props(styles.stroke)}
        d="M8.5 3.5v-1a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1"
      />
    </svg>
  );
}

const COPIED_FOR_MS = 1200;

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);

    return () => clearTimeout(timer);
  }, [copied]);

  // The workbench denies DOM clipboard requests; copyText falls back to
  // execCommand and reports whether anything was copied.
  const copy = () =>
    void copyText(text).then((ok) => {
      if (ok) setCopied(true);
    });

  return [copied, copy] as const;
}

/** Text, such as an error, that underlines on hover and copies on click. */
export function CopyableText({
  text,
  children = text,
}: {
  text: string;
  children?: ReactNode;
}): ReactElement {
  const [copied, copy] = useCopy(text);

  const tooltip = useTooltip<HTMLSpanElement>(
    copied ? "Copied" : "Click to copy",
    { instant: true },
  );

  return (
    <span
      ref={tooltip}
      role="button"
      tabIndex={0}
      {...stylex.props(styles.copyable)}
      onClick={() => {
        // A drag that selects part of the text should not copy all of it.
        if (document.getSelection()?.isCollapsed !== false) copy();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        copy();
      }}
    >
      {children}
    </span>
  );
}

/** An icon button that copies `text` and shows a check while it is copied. */
export function CopyButton({
  text,
  label,
  className,
  xstyle,
  iconStyle,
}: {
  text: string;
  label: string;
  className?: string;
  xstyle?: stylex.StyleXStyles;
  iconStyle: stylex.StyleXStyles;
}): ReactElement {
  const [copied, copy] = useCopy(text);
  const tooltip = useTooltip(label);

  return (
    <IconButton
      ref={tooltip}
      className={className}
      xstyle={xstyle}
      aria-label={label}
      data-copied={copied ? "" : undefined}
      onClick={copy}
    >
      {copied ? (
        <CheckIcon xstyle={iconStyle} />
      ) : (
        <CopyGlyph xstyle={iconStyle} />
      )}
    </IconButton>
  );
}

const styles = stylex.create({
  copyable: {
    cursor: "pointer",
    textDecorationLine: { default: "none", ":hover": "underline" },
    textUnderlineOffset: "2px",
  },
  icon: {
    width: "12px",
    height: "12px",
  },
  stroke: {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.2",
  },
});
