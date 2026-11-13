import { type KeyboardEvent, type RefObject, useEffect, useRef } from "react";

import { LinkedCode, LinkedCodeHost } from "./linked-code";
import type { CodeCheck, Repo } from "./verify";

/**
 * The code behind what the reader clicked or the step they are on, docked
 * beside the stage: each reference's linked lines in the canvas's code
 * peek, the evidence it checks for, and whether it still holds. Escape or the close
 * button closes it and returns focus to the stage.
 */
export function CodeView({
  title,
  subtitle,
  checks,
  repo,
  focusOnOpen,
  returnFocus,
  onClose,
}: {
  title: string;
  /** "Step 3 of 8" while it follows the steps. */
  subtitle?: string;
  /** Empty for a claim nothing backs yet. */
  checks: CodeCheck[];
  /** The files the code peeks read. */
  repo: Repo;
  /** Move focus in when it opens from a click, not while it follows
   * steps the reader is taking with the keyboard. */
  focusOnOpen: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [focusOnOpen, title]);

  const close = () => {
    onClose();
    returnFocus.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };

  return (
    <aside className="code-view" aria-label="Code" onKeyDown={onKeyDown}>
      <header className="code-view-header">
        <div className="code-view-titles">
          {subtitle && <span className="code-view-subtitle">{subtitle}</span>}
          <h2 ref={heading} className="code-view-title" tabIndex={-1}>
            {title}
          </h2>
        </div>
        <button
          type="button"
          className="block-action"
          aria-label="Close code"
          title="Close (Esc)"
          onClick={close}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3.5 3.5l7 7M10.5 3.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      {checks.length ? (
        <LinkedCodeHost repo={repo}>
          <ol className="code-view-list">
            {checks.map((check) => (
              <li key={check.name}>
                <CodeEntry check={check} />
              </li>
            ))}
          </ol>
        </LinkedCodeHost>
      ) : (
        <p className="code-view-empty">
          Nothing links this to code yet, so there is no way to check it.
        </p>
      )}
    </aside>
  );
}

function CodeEntry({ check }: { check: CodeCheck }) {
  const evidence = check.ref?.evidence;

  return (
    <article className="code-entry" data-state={check.state}>
      <div className="code-entry-head">
        <span className="code-entry-title">
          {check.ref?.title ?? check.name}
        </span>
        <span className="code-entry-state">
          {check.state === "checked" ? "Matches" : "Changed"}
        </span>
      </div>
      {evidence && (
        <span className="code-entry-evidence">
          Looks for <code>{evidence}</code>
        </span>
      )}
      {check.reason && <p className="code-entry-reason">{check.reason}</p>}
      {check.lines && check.ref && <LinkedCode anchor={check.ref.anchor} />}
      {check.movedTo && (
        <>
          <span className="code-entry-evidence">Evidence now at</span>
          <LinkedCode anchor={`head/${check.path}#L${check.movedTo}`} />
        </>
      )}
    </article>
  );
}
