import type { AskEntry, AskThreadState } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { permissionSubject } from "./ask-turn";
import { fontSize, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import { textStyles } from "./ui/text";
import { useTooltip } from "./use-tooltip";

type PermissionEntry = Extract<AskEntry, { kind: "permission" }>;

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
  entry: PermissionEntry;
  thread: AskThreadState;
  onDecide: (permissionId: string, optionId: string) => void;
}): ReactElement {
  const placeTooltip = useTooltip<HTMLSpanElement>(thread.cwd);
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
          ref={placeTooltip}
          {...stylex.props(permissionStyles.targetPlace)}
        >
          in {shortPath(thread.cwd)}@{thread.head.slice(0, 7)}
        </span>
      </div>
      <div {...stylex.props(permissionStyles.options)}>
        {options.map((option, index) => (
          <PermissionOption
            key={option.optionId}
            option={option}
            label={named ? option.name : optionLabels[option.kind]}
            // Denials sit apart, at the far end.
            apart={
              option.kind.startsWith("reject") &&
              Boolean(options[index - 1]?.kind.startsWith("allow"))
            }
            // A thread that stopped no longer waits on the answer.
            disabled={thread.status !== "waiting"}
            onClick={() => onDecide(entry.id, option.optionId)}
          />
        ))}
      </div>
    </section>
  );
}

function PermissionOption({
  option,
  label,
  apart,
  disabled,
  onClick,
}: {
  option: PermissionEntry["options"][number];
  label: string;
  apart: boolean;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  const tooltip = useTooltip(option.name);

  return (
    <Button
      ref={tooltip}
      size="large"
      variant={
        option.kind === "allow_once"
          ? "warning"
          : option.kind.startsWith("reject")
            ? "ghost"
            : "secondary"
      }
      xstyle={apart && permissionStyles.apart}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

const permissionStyles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "16px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.warningOutline,
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
    borderWidth: "1px",
    borderStyle: "solid",
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
  apart: {
    marginLeft: "auto",
  },
});
