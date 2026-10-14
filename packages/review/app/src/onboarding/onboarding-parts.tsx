import { withClass } from "@canvas/stylex-props";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect } from "react";

import { onboardingStyles as styles } from "./onboarding-styles";

/** The ring an agent's or an install's work turns in. */
export function Spinner() {
  return (
    <svg
      {...stylex.props(styles.spinner)}
      viewBox="0 0 22 22"
      aria-hidden="true"
    >
      <circle {...stylex.props(styles.spinnerTrack)} cx="11" cy="11" r="9" />
      <path {...stylex.props(styles.spinnerArc)} d="M11 2a9 9 0 0 1 9 9" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 7h9.5M7.5 3l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Return presses the screen's one button, as the hint beside it says. */
export function useReturnKey(enabled: boolean, onReturn: () => void) {
  useEffect(() => {
    if (!enabled) return;

    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;

      if (
        event.key !== "Enter" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        target?.closest("textarea, input, button, select, [contenteditable]")
      )
        return;
      event.preventDefault();
      onReturn();
    };

    window.addEventListener("keydown", keydown);

    return () => window.removeEventListener("keydown", keydown);
  }, [enabled, onReturn]);
}

/** `y` copies, as it yanks in vim: never while the reader types in a field. */
export function useCopyKey(enabled: boolean, onCopy: () => void) {
  useEffect(() => {
    if (!enabled) return;

    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;

      if (
        event.key !== "y" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat ||
        target?.closest("textarea, input, select, [contenteditable]")
      )
        return;
      event.preventDefault();
      onCopy();
    };

    window.addEventListener("keydown", keydown);

    return () => window.removeEventListener("keydown", keydown);
  }, [enabled, onCopy]);
}

/** Where a screen outside first run goes back to, in place of its eyebrow. */
export interface BackLink {
  label: string;
  onClick(): void;
}

/** A working screen's title bar: what the step is, and its one action. */
export function ScreenHeader({
  eyebrow,
  back,
  heading,
  lead,
  children,
}: {
  eyebrow?: string;
  back?: BackLink;
  heading: string;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header {...stylex.props(styles.titleBar)}>
      <div {...stylex.props(styles.titleText)}>
        {back ? (
          <button
            type="button"
            {...stylex.props(styles.backLink, styles.enter0)}
            onClick={back.onClick}
          >
            ← {back.label}
          </button>
        ) : eyebrow ? (
          <span
            {...stylex.props(
              styles.eyebrow,
              styles.titleEyebrow,
              styles.enter0,
            )}
          >
            {eyebrow}
          </span>
        ) : null}
        <h1
          {...withClass(
            "review-onboarding-headline",
            styles.heading,
            styles.enter1,
          )}
        >
          {heading}
        </h1>
        <p {...stylex.props(styles.subLead, styles.enter2)}>{lead}</p>
      </div>
      {children ? (
        <div {...stylex.props(styles.titleActions, styles.enter2)}>
          {children}
        </div>
      ) : null}
    </header>
  );
}

export function ScreenCopy({
  eyebrow,
  heading,
  hero,
  lead,
  children,
}: {
  eyebrow: string;
  heading: string;
  hero?: boolean;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.copy)}>
      <span {...stylex.props(styles.eyebrow, styles.enter0)}>{eyebrow}</span>
      <h1
        {...withClass(
          "review-onboarding-headline",
          hero ? styles.hero : styles.title,
          styles.enter1,
        )}
      >
        {heading}
      </h1>
      {lead ? (
        <p {...stylex.props(styles.lead, styles.enter2)}>{lead}</p>
      ) : null}
      {children ? (
        <div {...stylex.props(styles.actions, styles.enter3)}>{children}</div>
      ) : null}
    </div>
  );
}
