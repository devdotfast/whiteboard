import { documentStyles } from "@canvas/document-styles";
import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";

type EmptyStateProps = Omit<
  ComponentProps<"div">,
  "className" | "style" | "title" | "role"
> & {
  // A document reads it as its own heading and prose; inline is a quiet note
  // in a pane; boxed stands in for a figure.
  variant?: "document" | "inline" | "boxed";
  title?: ReactNode;
  message: ReactNode;
  // Defaults to alert in a document, status elsewhere.
  role?: "alert" | "status";
  action?: ReactNode;
  className?: string;
  xstyle?: StyleArg;
};

export function EmptyState({
  variant = "inline",
  title,
  message,
  role = variant === "document" ? "alert" : "status",
  action,
  className,
  xstyle,
  ...props
}: EmptyStateProps): ReactElement {
  if (variant === "document") {
    return (
      <div role={role} {...props} {...withClass(className, xstyle)}>
        {title ? <h2 {...stylex.props(documentStyles.h2)}>{title}</h2> : null}
        <p {...stylex.props(documentStyles.note)}>{message}</p>
        {action}
      </div>
    );
  }

  const boxed = variant === "boxed";
  const Title = boxed ? "h3" : "p";

  return (
    <div
      role={role}
      {...props}
      {...withClass(className, styles[variant], xstyle)}
    >
      {title ? (
        <Title {...stylex.props(styles.title, boxed && styles.boxedTitle)}>
          {title}
        </Title>
      ) : null}
      <p {...stylex.props(styles.message, boxed && styles.boxedMessage)}>
        {message}
      </p>
      {action}
    </div>
  );
}

// A boxed notice in a document reads as the document's heading and prose.
const inDocument = ":is(.review-document *)";

const styles = stylex.create({
  inline: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    // Aligned to the pane's own content edge.
    paddingBlock: "16px",
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
    lineHeight: 1.55,
  },
  boxed: {
    boxSizing: "border-box",
    display: "grid",
    placeContent: "center",
    justifyItems: "center",
    padding: "32px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    textAlign: "center",
  },
  title: {
    margin: 0,
    color: tokens.ink,
    fontWeight: fontWeight.medium,
  },
  message: {
    margin: 0,
  },
  boxedTitle: {
    marginBottom: "8px",
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: fontSize.reading, [inDocument]: fontSize.heading },
    lineHeight: 1.3,
  },
  boxedMessage: {
    maxWidth: "540px",
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: fontSize.ui, [inDocument]: fontSize.reading },
    lineHeight: { default: 1.55, [inDocument]: 1.72 },
    textAlign: { default: null, [inDocument]: "left" },
  },
});
