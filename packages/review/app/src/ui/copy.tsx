import { IconButton } from "@canvas/ui/button";
import { useUiTooltip } from "@canvas/ui/host";
import { CheckIcon, CopyIcon } from "@canvas/ui/icons";
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

/** Copies text; `copied` is the last text copied, for a moment after. */
export function useCopy({
  onCopied,
  onFailed,
}: { onCopied?(): void; onFailed?(): void } = {}) {
  // A new object per copy restarts the moment when the same text is copied again.
  const [copied, setCopied] = useState<{ text: string } | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_FOR_MS);

    return () => clearTimeout(timer);
  }, [copied]);

  // The workbench denies DOM clipboard requests, so copyText falls back to execCommand.
  const copy = (text: string) =>
    void copyText(text).then((ok) => {
      if (!ok) return onFailed?.();
      setCopied({ text });
      onCopied?.();
    });

  return [copied?.text ?? null, copy] as const;
}

export function CopyableText({
  text,
  children = text,
}: {
  text: string;
  children?: ReactNode;
}): ReactElement {
  const [copiedText, copy] = useCopy();
  const copied = copiedText === text;

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
        if (document.getSelection()?.isCollapsed !== false) copy(text);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        copy(text);
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
  const [copiedText, copy] = useCopy();
  const copied = copiedText === text;
  const tooltip = useUiTooltip(label);

  return (
    <IconButton
      ref={tooltip}
      className={className}
      xstyle={xstyle}
      aria-label={label}
      data-copied={copied ? "" : undefined}
      onClick={() => copy(text)}
    >
      {copied ? (
        <CheckIcon xstyle={iconStyle} />
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
});
