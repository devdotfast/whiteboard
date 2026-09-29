import {
  type ReviewBugReportRequest,
  parseReviewBugReportResponse,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";

import {
  ScreenshotTooLargeError,
  captureWindowScreenshot,
  imageFileFromDataTransfer,
  normalizeScreenshot,
} from "./bug-report-screenshot";
import { controlStyles } from "./controls-styles";
import { useReviewSession } from "./host/review-session";
import { BugIcon } from "./icons";
import { shellStyles } from "./shell-styles";
import { useToast } from "./toast";
import { tokens } from "./tokens.stylex";
import { useTutorial } from "./tutorial-context";
import { captureUiEvent, clientErrorName } from "./ui-telemetry";
import { useTooltip } from "./use-tooltip";

const MAX_DESCRIPTION_BYTES = 64 * 1024;

export function BugReportControl({
  captureScreenshot = captureWindowScreenshot,
}: {
  /** Captures the window when the dialog opens; tests inject a fake. */
  captureScreenshot?: typeof captureWindowScreenshot;
} = {}) {
  const session = useReviewSession();
  const tutorial = useTutorial();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [includeDiff, setIncludeDiff] = useState(true);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const { toast, showToast: setToast } = useToast();
  const tooltip = useTooltip("Report a bug");
  const capturePending = useRef(false);
  const descriptionBytes = new TextEncoder().encode(description).byteLength;
  const canSend = descriptionBytes <= MAX_DESCRIPTION_BYTES && !sending;

  const reset = () => {
    setDescription("");
    setIncludeContext(true);
    setIncludeDiff(true);
    setScreenshot(null);
    setDropActive(false);
    setSending(false);
  };

  const cancel = () => {
    captureUiEvent(session, "bug_report_cancelled");
    reset();
    setOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSend) return;
    setSending(true);

    try {
      const report: ReviewBugReportRequest = {
        description,
        include_review: includeContext,
        include_map: includeContext,
        include_diff: includeDiff,
        // No JSON-review snapshot records its authoring session yet, so
        // there is no complete trace to attach.
        include_trace: false,
        app_session_id: session.appSessionId,
        app_version: session.config.appVersion,
      };

      if (screenshot) {
        report.screenshot = {
          mime: "image/jpeg",
          base64: screenshot.slice("data:image/jpeg;base64,".length),
        };
      }

      const response = await session.fetch("/telemetry/bug-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        captureUiEvent(session, "bug_report_send_failed", {
          error_name: clientErrorName(new Error()),
        });
        setToast({
          kind: "error",
          text:
            response.status === 429
              ? "Too many reports. Try again later."
              : response.status === 413
                ? "The report is too large. Remove an attachment and try again."
                : "The report could not be sent. Try again.",
        });

        return;
      }

      const result = parseReviewBugReportResponse(body);

      if (!result.ok) throw new Error(result.error);
      setToast({
        kind: "success",
        text: "Bug report was sent.",
      });
      reset();
      setOpen(false);
    } catch (error) {
      captureUiEvent(session, "bug_report_send_failed", {
        error_name: clientErrorName(error),
      });
      setToast({
        kind: "error",
        text: "The report could not be sent. Try again.",
      });
    } finally {
      setSending(false);
    }
  };

  const attachScreenshot = async (image: Blob) => {
    try {
      const normalized = await normalizeScreenshot(image);

      if (!normalized) throw new Error("Screenshot could not be decoded.");
      setScreenshot(normalized);
    } catch (error) {
      setToast({
        kind: "error",
        text:
          error instanceof ScreenshotTooLargeError
            ? "The screenshot is too large. Use an image under 3 MiB."
            : "That image could not be attached. Use a PNG, JPEG, or WebP image.",
      });
    }
  };

  const pasteScreenshot = (event: ClipboardEvent<HTMLElement>) => {
    const image = imageFileFromDataTransfer(event.clipboardData);

    if (!image) return;
    event.preventDefault();
    void attachScreenshot(image);
  };

  const dropScreenshot = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropActive(false);
    const image = imageFileFromDataTransfer(event.dataTransfer);

    if (!image) {
      setToast({
        kind: "error",
        text: "That image could not be attached. Use a PNG, JPEG, or WebP image.",
      });

      return;
    }

    void attachScreenshot(image);
  };

  const openDialog = async () => {
    if (tutorial || capturePending.current) return;
    capturePending.current = true;
    setCapturing(true);
    captureUiEvent(session, "bug_report_dialog_opened");
    let captured: string | null = null;

    try {
      captured = await captureScreenshot(session.bridge);
    } finally {
      setScreenshot(captured);
      setOpen(true);
      setCapturing(false);
      capturePending.current = false;
    }
  };

  return (
    <>
      <button
        type="button"
        {...stylex.props(shellStyles.topbarItem, styles.topbarButton)}
        aria-label="Report a bug"
        ref={tooltip}
        disabled={tutorial !== null || capturing}
        onClick={() => void openDialog()}
      >
        <BugIcon xstyle={controlStyles.chromeIcon} />
      </button>
      {open && (
        <div
          {...stylex.props(shellStyles.topbarItem, styles.backdrop)}
          onMouseDown={cancel}
        >
          <section
            {...stylex.props(styles.dialog, dropActive && styles.dropTarget)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-report-title"
            onMouseDown={(event) => event.stopPropagation()}
            onPaste={pasteScreenshot}
            onDragOver={(event) => {
              event.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget;

              if (next instanceof Node && event.currentTarget.contains(next)) {
                return;
              }

              setDropActive(false);
            }}
            onDrop={dropScreenshot}
          >
            <form {...stylex.props(styles.form)} onSubmit={submit}>
              <h2 {...stylex.props(styles.title)} id="bug-report-title">
                Report a bug
              </h2>
              <label {...stylex.props(styles.description)}>
                <span>What happened? (optional)</span>
                <textarea
                  {...stylex.props(styles.textarea)}
                  autoFocus
                  rows={7}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe what you expected and what happened."
                />
              </label>
              <div
                {...stylex.props(
                  styles.byteCount,
                  descriptionBytes > MAX_DESCRIPTION_BYTES &&
                    styles.byteCountError,
                )}
              >
                {descriptionBytes.toLocaleString()} / 65,536 bytes
              </div>
              <fieldset {...stylex.props(styles.fieldset)}>
                <legend {...stylex.props(styles.small)}>
                  Include diagnostic attachments
                </legend>
                <label {...stylex.props(styles.small, styles.option)}>
                  <input
                    type="checkbox"
                    checked={includeContext}
                    onChange={(event) =>
                      setIncludeContext(event.target.checked)
                    }
                  />
                  Session
                </label>
                <label {...stylex.props(styles.small, styles.option)}>
                  <input
                    type="checkbox"
                    checked={includeDiff}
                    onChange={(event) => setIncludeDiff(event.target.checked)}
                  />
                  Changed-file diffs used by CodePeeks
                </label>
                <div {...stylex.props(styles.screenshot)}>
                  {screenshot ? (
                    <>
                      <img
                        {...stylex.props(styles.screenshotImage)}
                        src={screenshot}
                        alt="Screenshot preview"
                      />
                      <button
                        type="button"
                        {...stylex.props(styles.screenshotRemove)}
                        aria-label="Remove screenshot"
                        title="Remove screenshot"
                        onClick={() => setScreenshot(null)}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span {...stylex.props(styles.small, styles.faint)}>
                      Paste or drop an image to attach a screenshot.
                    </span>
                  )}
                </div>
              </fieldset>
              <p {...stylex.props(styles.small, styles.privacy)}>
                Reports are sent securely to /dev/fast. Only authorized
                /dev/fast team members can access them. Reports are deleted
                after 90 days. The screenshot above is included unless you
                remove it.
              </p>
              <div {...stylex.props(styles.actions)}>
                <button
                  type="button"
                  {...stylex.props(styles.action)}
                  onClick={cancel}
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  {...stylex.props(styles.action, styles.submit)}
                  disabled={!canSend}
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {toast}
    </>
  );
}

// Only .review-app defines the chrome tokens, and the border and font came
// from shorthands that drop out without them: outside the app there are none.
// (:scope is the canvas root, so an app portaled out of it does not count.)
const inApp = ":is(:scope .review-app *)";

const chromeBorder = {
  borderWidth: { default: 0, [inApp]: "1px" },
  borderStyle: { default: "none", [inApp]: "solid" },
  borderColor: tokens.chromeBorder,
} as const;

const styles = stylex.create({
  topbarButton: {
    display: "grid",
    alignItems: "center",
    justifyContent: "center",
    width: tokens.chromeControlHeight,
    height: tokens.chromeControlHeight,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: tokens.chromeControlRadius,
    backgroundColor: {
      default: tokens.transparent,
      ":hover:not(:disabled)": tokens.chromeHoverBg,
      ":focus-visible:not(:disabled)": tokens.chromeHoverBg,
    },
    color: {
      default: tokens.chromeIconFg,
      ":hover:not(:disabled)": tokens.chromeFg,
      ":focus-visible:not(:disabled)": tokens.chromeFg,
    },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.45 },
    outline: {
      default: null,
      ":hover:not(:disabled)": "none",
      ":focus-visible:not(:disabled)": "none",
    },
  },
  backdrop: {
    position: "fixed",
    zIndex: 10000,
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    backgroundColor: tokens.backdrop,
  },
  dialog: {
    width: "min(540px, 100%)",
    ...chromeBorder,
    borderRadius: "8px",
    backgroundColor: tokens.bg,
    boxShadow: `0 18px 60px ${tokens.shadowColorStrong}`,
    color: tokens.ink,
  },
  dropTarget: {
    outline: `2px dashed ${tokens.accent}`,
    outlineOffset: "-7px",
  },
  form: {
    display: "grid",
    gap: "14px",
    padding: "20px",
  },
  title: {
    margin: 0,
    fontSize: "18px",
  },
  description: {
    display: "grid",
    gap: "7px",
    fontSize: "12px",
    fontWeight: 600,
  },
  textarea: {
    boxSizing: "border-box",
    width: "100%",
    resize: "vertical",
    ...chromeBorder,
    borderRadius: "5px",
    padding: "9px",
    backgroundColor: tokens.tray,
    color: tokens.ink,
    font: `12px/1.5 ${tokens.fontMono}`,
  },
  byteCount: {
    marginTop: "-10px",
    color: tokens.inkFaint,
    font: `10px/1.3 ${tokens.fontMono}`,
    textAlign: "right",
  },
  byteCountError: {
    color: tokens.diffModified,
  },
  fieldset: {
    display: "grid",
    gap: "8px",
    margin: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "5px",
    padding: "10px 12px 12px",
  },
  small: {
    font: `11px/1.45 ${tokens.fontMono}`,
  },
  option: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  screenshot: {
    display: "flex",
    minHeight: "54px",
    alignItems: "center",
    gap: "8px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: tokens.ruleSoft,
    borderRadius: "5px",
    padding: "8px",
  },
  screenshotImage: {
    display: "block",
    maxWidth: "calc(100% - 34px)",
    maxHeight: "72px",
    ...chromeBorder,
    borderRadius: "4px",
  },
  screenshotRemove: {
    display: "grid",
    width: "26px",
    height: "26px",
    placeItems: "center",
    ...chromeBorder,
    borderColor: {
      default: tokens.chromeBorder,
      ":hover": tokens.chromeActiveBorder,
      ":focus-visible": tokens.chromeActiveBorder,
    },
    borderRadius: "4px",
    padding: 0,
    backgroundColor: tokens.tray,
    color: {
      default: tokens.inkFaint,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    font: { default: "inherit", [inApp]: `18px/1 ${tokens.chromeFont}` },
    cursor: "pointer",
    outline: { default: null, ":hover": "none", ":focus-visible": "none" },
  },
  faint: {
    color: tokens.inkFaint,
  },
  privacy: {
    margin: 0,
    color: tokens.inkFaint,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
  },
  action: {
    minWidth: "76px",
    ...chromeBorder,
    borderRadius: "4px",
    padding: "7px 12px",
    backgroundColor: tokens.tray,
    color: tokens.ink,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.45 },
  },
  submit: {
    borderColor: tokens.rpc,
  },
});
