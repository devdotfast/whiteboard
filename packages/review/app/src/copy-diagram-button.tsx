import * as stylex from "@stylexjs/stylex";
import { type MouseEvent, useEffect, useState } from "react";

import { captureDiagramInHiddenPage } from "./diagram-hidden-capture";
import { diagramStyles } from "./diagram-styles";
import { useReviewSession } from "./host/review-session";
import { CheckIcon, CopyIcon } from "./icons";
import { withClass } from "./stylex-props";
import { useTooltip } from "./use-tooltip";

export function CopyDiagramButton() {
  const { bridge } = useReviewSession();

  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );

  const [errorDetail, setErrorDetail] = useState("");

  const label =
    state === "copying"
      ? "Copying diagram"
      : state === "copied"
        ? "Diagram copied"
        : state === "error"
          ? `Copy diagram failed: ${errorDetail}. Try again`
          : "Copy diagram as image";

  const tooltip = useTooltip(label);

  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), 1200);

    return () => window.clearTimeout(timer);
  }, [state]);

  const capture = bridge.capturePageImage;

  if (!capture) return null;

  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setState("copying");

    try {
      const figure = event.currentTarget.closest<HTMLElement>("figure");

      if (!figure) throw new Error("Diagram is not ready to copy.");

      await captureDiagramInHiddenPage(figure, capture);

      setState("copied");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      setState("error");
      setErrorDetail(detail);
      bridge.notify?.({
        kind: "error",
        text: `Could not copy diagram: ${detail}`,
      });
    }
  };

  return (
    <button
      ref={tooltip}
      type="button"
      {...withClass(
        "diagram-copy-button",
        diagramStyles.control,
        styles.button,
      )}
      onClick={copy}
      disabled={state === "copying"}
      aria-label={label}
    >
      {state === "copied" ? (
        <CheckIcon xstyle={styles.icon} />
      ) : (
        <CopyIcon xstyle={styles.icon} />
      )}
    </button>
  );
}

const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    padding: "4px",
    cursor: { default: "pointer", ":disabled": "progress" },
    opacity: { default: 1, ":disabled": 0.6 },
  },
  icon: {
    width: "14px",
    height: "14px",
    strokeWidth: "1.5",
  },
});
