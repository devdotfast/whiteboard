import { IconButton } from "@canvas/ui/button";
import { useUiTooltip } from "@canvas/ui/host";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

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

const COPIED_FOR_MS = 1200;

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);

    return () => clearTimeout(timer);
  }, [copied]);

  // The workbench denies DOM clipboard requests, so copyText falls back to execCommand.
  const copy = () =>
    void copyText(text).then((ok) => {
      if (ok) setCopied(true);
    });

  return [copied, copy] as const;
}

export function CopyIcon({
  xstyle,
}: { xstyle?: stylex.StyleXStyles } = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function CheckGlyph({ xstyle }: { xstyle: stylex.StyleXStyles }) {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function CopyableText({
  text,
  children = text,
}: {
  text: string;
  children?: ReactNode;
}): ReactElement {
  const [copied, copy] = useCopy(text);

  const tooltip = useUiTooltip<HTMLSpanElement>(
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
  const tooltip = useUiTooltip(label);

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
        <CheckGlyph xstyle={iconStyle} />
      ) : (
        <CopyIcon xstyle={iconStyle} />
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
    width: "15px",
    height: "15px",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.7px",
  },
});
