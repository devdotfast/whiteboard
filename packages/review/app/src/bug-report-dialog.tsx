import { Button, IconButton } from "@canvas/ui/button";
import { Checkbox } from "@canvas/ui/checkbox";
import { Dialog } from "@canvas/ui/dialog";
import { iconStyles } from "@canvas/ui/icon-styles";
import { BugIcon, CloseIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import { TextArea } from "@canvas/ui/text-field";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  type ReviewBugReportRequest,
  parseReviewBugReportResponse,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  ScreenshotTooLargeError,
  captureWindowScreenshot,
  imageFileFromDataTransfer,
  normalizeScreenshot,
} from "./bug-report-screenshot";
import { useReviewSession } from "./host/review-session";
import { appMarker } from "./markers.stylex";
import { useNotify } from "./notify";
import { fontSize, fontWeight, leading, radius, space } from "./scale.stylex";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { captureUiEvent, clientErrorName } from "./ui-telemetry";

const MAX_DESCRIPTION_BYTES = 64 * 1024;

export function BugReportControl({
  captureScreenshot = captureWindowScreenshot,
  folded = false,
  handle,
}: {
  /** Captures the window when the dialog opens; tests inject a fake. */
  captureScreenshot?: typeof captureWindowScreenshot;
  /** In "⋯": no button; `handle` opens the dialog. */
  folded?: boolean;
  handle?: Ref<{ open(): void }>;
} = {}) {
  const session = useReviewSession();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [includeDiff, setIncludeDiff] = useState(true);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();
  const tooltip = useTooltip("Report a bug");
  const capturePending = useRef(false);
  const descriptionBytes = new TextEncoder().encode(description).byteLength;
  const canSend = descriptionBytes <= MAX_DESCRIPTION_BYTES;

  const reset = () => {
    setDescription("");
    setIncludeContext(true);
    setIncludeDiff(true);
    setScreenshot(null);
    setDropActive(false);
    setSending(false);
    setError(null);
  };

  const cancel = () => {
    captureUiEvent(session, "bug_report_cancelled");
    reset();
    setOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSend || sending) return;
    setSending(true);
    setError(null);

    try {
      const report: ReviewBugReportRequest = {
        description,
        include_review: includeContext,
        include_map: includeContext,
        include_diff: includeDiff,
        app_session_id: session.appSessionId,
        app_version: session.bridge.appVersion,
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
        setError(
          response.status === 429
            ? "Too many reports. Try again later."
            : response.status === 413
              ? "The report is too large. Remove an attachment and try again."
              : "The report could not be sent. Try again.",
        );

        return;
      }

      const result = parseReviewBugReportResponse(body);

      if (!result.ok) throw new Error(result.error);
      notify({
        kind: "success",
        text: "Bug report was sent.",
        closeAfterMs: 5_000,
      });
      reset();
      setOpen(false);
    } catch (error) {
      captureUiEvent(session, "bug_report_send_failed", {
        error_name: clientErrorName(error),
      });
      setError("The report could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  const attachScreenshot = async (image: Blob) => {
    try {
      const normalized = await normalizeScreenshot(image);

      if (!normalized) throw new Error("Screenshot could not be decoded.");
      setScreenshot(normalized);
      setError(null);
    } catch (error) {
      setError(
        error instanceof ScreenshotTooLargeError
          ? "The screenshot is too large. Use an image under 3 MiB."
          : "That image could not be attached. Use a PNG, JPEG, or WebP image.",
      );
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
      setError(
        "That image could not be attached. Use a PNG, JPEG, or WebP image.",
      );

      return;
    }

    void attachScreenshot(image);
  };

  const openDialog = async () => {
    if (capturePending.current) return;
    capturePending.current = true;
    captureUiEvent(session, "bug_report_dialog_opened");
    let captured: string | null = null;

    try {
      captured = await captureScreenshot(session.bridge);
    } finally {
      setScreenshot(captured);
      setOpen(true);
      capturePending.current = false;
    }
  };

  useImperativeHandle(handle, () => ({ open: () => void openDialog() }));

  return (
    <>
      {folded ? null : (
        <IconButton
          xstyle={shellStyles.topbarItem}
          aria-label="Report a bug"
          data-page-bar-fold="chat"
          ref={tooltip}
          onClick={() => void openDialog()}
        >
          <BugIcon xstyle={iconStyles.chrome} />
        </IconButton>
      )}
      {open && (
        <Dialog
          aria-labelledby="bug-report-title"
          closedby="any"
          xstyle={[styles.dialog, dropActive && styles.dropTarget]}
          onClose={cancel}
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
              <TextArea
                xstyle={styles.textarea}
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
                <Checkbox
                  checked={includeContext}
                  onChange={(event) => setIncludeContext(event.target.checked)}
                />
                Session
              </label>
              <label {...stylex.props(styles.small, styles.option)}>
                <Checkbox
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
                    <IconButton
                      xstyle={styles.screenshotRemove}
                      aria-label="Remove screenshot"
                      title="Remove screenshot"
                      onClick={() => setScreenshot(null)}
                    >
                      <CloseIcon />
                    </IconButton>
                  </>
                ) : (
                  <span {...stylex.props(styles.small, styles.faint)}>
                    Paste or drop an image to attach a screenshot.
                  </span>
                )}
              </div>
            </fieldset>
            <p {...stylex.props(styles.small, styles.privacy)}>
              Reports are sent securely to /dev/fast. Only authorized /dev/fast
              team members can access them. Reports are deleted after 90 days.
              The screenshot above is included unless you remove it.
            </p>
            {error && (
              <p
                {...stylex.props(styles.small, styles.error, textStyles.error)}
                role="alert"
              >
                {error}
              </p>
            )}
            <div {...stylex.props(styles.actions)}>
              <Button
                size="large"
                xstyle={styles.action}
                onClick={cancel}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="large"
                xstyle={styles.action}
                disabled={!canSend}
              >
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

// Only the app root defines the chrome tokens, and the border and font came
// from shorthands that drop out without them: outside the app there are none.
const inApp = () => stylex.when.ancestor(":is(*)", appMarker);

const chromeBorder = () =>
  ({
    borderWidth: { default: 0, [inApp()]: "1px" },
    borderStyle: { default: "none", [inApp()]: "solid" },
    borderColor: tokens.chromeBorder,
  }) as const;

const styles = stylex.create({
  dialog: {
    width: "min(540px, 100%)",
  },
  dropTarget: {
    outline: `2px dashed ${tokens.accent}`,
    outlineOffset: "-7px",
  },
  form: {
    display: "grid",
    gap: space.s14,
    padding: space.s20,
  },
  title: {
    margin: 0,
    fontSize: fontSize.heading,
  },
  description: {
    display: "grid",
    gap: space.s8,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  textarea: {
    width: "100%",
  },
  byteCount: {
    marginTop: `-${space.s10}`,
    color: tokens.inkFaint,
    font: `${fontSize.micro}/${leading.tight} ${tokens.fontMono}`,
    textAlign: "right",
  },
  byteCountError: {
    color: tokens.diffModified,
  },
  fieldset: {
    display: "grid",
    gap: space.s8,
    margin: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.small,
    padding: `${space.s10} ${space.s12} ${space.s12}`,
  },
  small: {
    font: `${fontSize.small}/${leading.normal} ${tokens.chromeFont}`,
  },
  option: {
    display: "flex",
    gap: space.s8,
    alignItems: "center",
  },
  screenshot: {
    display: "flex",
    minHeight: "54px",
    alignItems: "center",
    gap: space.s8,
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.small,
    padding: space.s8,
  },
  screenshotImage: {
    display: "block",
    maxWidth: "calc(100% - 34px)",
    maxHeight: "72px",
    ...chromeBorder(),
    borderRadius: radius.small,
  },
  screenshotRemove: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.chromeBorder,
    backgroundColor: tokens.tray,
  },
  faint: {
    color: tokens.inkFaint,
  },
  privacy: {
    margin: 0,
    color: tokens.inkFaint,
  },
  error: {
    margin: 0,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: space.s8,
  },
  action: {
    minWidth: "76px",
  },
});
