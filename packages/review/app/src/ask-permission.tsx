import type { AskEntry, AskThreadState } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { permissionSubject } from "./ask-turn";
import { fontSize, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { textStyles } from "./ui/text";

const actions = new Map([
  ["execute", "run a command"],
  ["read", "read a file"],
  ["edit", "edit a file"],
  ["fetch", "fetch a page"],
  ["search", "search"],
]);

const optionLabels = {
  allow_once: "Allow once",
  allow_always: "Always allow",
  reject_once: "Deny",
  reject_always: "Always deny",
} as const;

const optionOrder = Object.keys(optionLabels);

/** The last two folders of the checkout, which is enough to recognize it. */
function shortPath(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);

  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

export function AskPermission({
  entry,
  thread,
  onDecide,
}: {
  entry: Extract<AskEntry, { kind: "permission" }>;
  thread: AskThreadState;
  onDecide: (permissionId: string, optionId: string) => void;
}): ReactElement {
  const command = entry.toolKind === "execute";

  const options = entry.options.toSorted(
    (left, right) =>
      optionOrder.indexOf(left.kind) - optionOrder.indexOf(right.kind),
  );

  // Two options of one kind differ in what the agent does next, which only
  // its own names say.
  const named = options.some(
    (option, index) =>
      options.findIndex((other) => other.kind === option.kind) !== index,
  );

  return (
    <section
      {...stylex.props(permissionStyles.card)}
      aria-label="Permission request"
    >
      <div {...stylex.props(permissionStyles.copy)}>
        <h3 {...stylex.props(textStyles.eyebrow, permissionStyles.heading)}>
          {thread.agentName} wants to{" "}
          {actions.get(entry.toolKind) ?? "use a tool"}
        </h3>
        <p {...stylex.props(permissionStyles.text)}>
          Whiteboard keeps this session read-only, so{" "}
          {command ? "commands need" : "this needs"} your OK.
        </p>
      </div>
      <div {...stylex.props(permissionStyles.target)}>
        <code {...stylex.props(permissionStyles.targetCode)}>
          {command ? "$ " : null}
          {permissionSubject(entry, thread.cwd)}
        </code>
        <span
          {...stylex.props(permissionStyles.targetPlace)}
          title={thread.cwd}
        >
          in {shortPath(thread.cwd)}@{thread.head.slice(0, 7)}
        </span>
      </div>
      <div {...stylex.props(permissionStyles.options)}>
        {options.map((option, index) => (
          <button
            key={option.optionId}
            type="button"
            title={option.name}
            // A thread that stopped no longer waits on the answer.
            disabled={thread.status !== "waiting"}
            {...stylex.props(
              permissionStyles.option,
              option.kind === "allow_once" && permissionStyles.allowOnce,
              option.kind.startsWith("reject") && permissionStyles.reject,
              // Denials sit apart, at the far end.
              option.kind.startsWith("reject") &&
                options[index - 1]?.kind.startsWith("allow") &&
                permissionStyles.apart,
            )}
            onClick={() => onDecide(entry.id, option.optionId)}
          >
            {named ? option.name : optionLabels[option.kind]}
          </button>
        ))}
      </div>
    </section>
  );
}

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

const permissionStyles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "16px",
    ...hairline,
    borderColor: tokens.warningFocus,
    borderRadius: radius.surface,
    backgroundColor: tokens.warningWash,
  },
  copy: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  heading: {
    margin: 0,
    color: tokens.changeModified,
    fontFamily: tokens.fontMono,
    lineHeight: "14px",
  },
  text: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  target: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    ...hairline,
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.bg,
  },
  targetCode: {
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  targetPlace: {
    overflow: "hidden",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  options: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
  },
  option: {
    padding: "6px 12px",
    ...hairline,
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.surfaceRaised,
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
  allowOnce: {
    borderColor: tokens.changeModified,
    backgroundColor: {
      default: tokens.changeModified,
      ":hover": `color-mix(in srgb, ${tokens.changeModified} 88%, white)`,
    },
    color: tokens.onWarning,
  },
  reject: {
    paddingInline: "4px",
    borderColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
  },
  apart: {
    marginLeft: "auto",
  },
});
