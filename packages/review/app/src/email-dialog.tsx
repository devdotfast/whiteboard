import { fontSize, fontWeight } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import { Kbd, Shortcut } from "@canvas/ui/kbd";
import { surfaceStyles } from "@canvas/ui/surface";
import { TextField } from "@canvas/ui/text-field";
import {
  REVIEW_FEEDBACK_CAMPAIGN,
  type ReviewCanvasUi,
  ReviewFeedbackContactSchema,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { createCanvasQueryClient } from "./canvas-query";
import { CloseIcon } from "./icons";
import { useNotify } from "./notify";

type Props = { host: NonNullable<ReviewCanvasUi["feedback"]>; onClose(): void };

export function EmailDialog(props: Props) {
  const [client] = useState(createCanvasQueryClient);

  return (
    <QueryClientProvider client={client}>
      <EmailForm {...props} />
    </QueryClientProvider>
  );
}

function EmailForm({ host, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const notify = useNotify();

  const save = useMutation({
    mutationFn: async (address: string) => {
      const result = await host.submitContact({
        kind: "contact",
        campaign: REVIEW_FEEDBACK_CAMPAIGN,
        environment: host.environment ?? "production",
        email: address,
      });

      if (!result.ok)
        throw new Error(
          result.error === "network"
            ? "Network error. Your email wasn’t saved. Please try again."
            : "Your email couldn’t be saved. Please try again.",
        );
    },
    onSuccess: () => {
      onClose();
      notify({ kind: "success", text: "Thanks for sharing your email." });
    },
  });

  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = element.ownerDocument.activeElement;
    element.showModal();

    return () => {
      element.close();

      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (save.isPending) dialog.current?.focus();
    else input.current?.focus();
  }, [save.isPending]);

  const error = invalid ? "Enter a valid email address." : save.error?.message;

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      {...stylex.props(surfaceStyles.dialog, styles.dialog)}
      onCancel={(event) => {
        event.preventDefault();

        if (!save.isPending) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const active = event.currentTarget.ownerDocument.activeElement;

          if (save.isPending) event.preventDefault();
          else if (event.shiftKey && active === closeButton.current) {
            event.preventDefault();
            submitButton.current?.focus();
          } else if (!event.shiftKey && active === submitButton.current) {
            event.preventDefault();
            closeButton.current?.focus();
          }
        }

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();

          if (!save.isPending) onClose();
        }

        if (event.key === "Enter" && event.nativeEvent.isComposing)
          event.preventDefault();
      }}
    >
      <form
        noValidate
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();

          if (save.isPending) return;
          const address = email.trim();

          if (
            !ReviewFeedbackContactSchema.shape.email.safeParse(address).success
          ) {
            setInvalid(true);
            input.current?.focus();

            return;
          }

          setInvalid(false);
          save.mutate(address);
        }}
      >
        <header {...stylex.props(styles.header)}>
          <h2 id={`${id}-title`} {...stylex.props(styles.heading)}>
            A note from the developers
          </h2>
          <IconButton
            ref={closeButton}
            aria-label="Close email form"
            disabled={save.isPending}
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </header>
        <div {...stylex.props(styles.note)}>
          <p {...stylex.props(styles.copy)}>
            We’d love to get in touch to hear feedback if you’re open to it.
          </p>
          <p {...stylex.props(styles.copy)}>
            Could you share an email so we can learn how to make your experience
            with the app better?
          </p>
          <p {...stylex.props(styles.copy)}>We promise we won’t be spammy :)</p>
        </div>
        <div {...stylex.props(styles.field)}>
          <label htmlFor={`${id}-email`} {...stylex.props(styles.label)}>
            Your email
          </label>
          <TextField
            ref={input}
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            variant="form"
            placeholder="you@example.com"
            maxLength={254}
            value={email}
            disabled={save.isPending}
            aria-invalid={invalid || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setInvalid(false);
              save.reset();
            }}
            xstyle={styles.input}
          />
          {error && (
            <p id={`${id}-error`} role="alert" {...stylex.props(styles.error)}>
              {error}
            </p>
          )}
        </div>
        <footer {...stylex.props(styles.footer)}>
          <Button
            size="large"
            variant="ghost"
            disabled={save.isPending}
            onClick={onClose}
          >
            Skip for now <Kbd aria-hidden="true">esc</Kbd>
          </Button>
          <Button
            size="large"
            type="submit"
            ref={submitButton}
            variant="primary"
            loading={save.isPending}
            aria-label={save.isPending ? "Sharing…" : "Share email"}
          >
            Share email <Shortcut aria-hidden="true">↵</Shortcut>
          </Button>
        </footer>
      </form>
    </dialog>
  );
}

const styles = stylex.create({
  dialog: {
    boxSizing: "border-box",
    width: "min(480px, calc(100% - 32px))",
    maxHeight: "calc(100% - 32px)",
    padding: "24px",
    "::backdrop": { backgroundColor: tokens.backdrop },
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    color: tokens.ink,
    fontFamily: tokens.fontSans,
    fontSize: fontSize.ui,
    lineHeight: 1.6,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
  },
  heading: {
    margin: 0,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.display,
    fontWeight: fontWeight.medium,
    lineHeight: "28px",
  },
  note: { display: "flex", flexDirection: "column", gap: "12px" },
  copy: { margin: 0, color: tokens.ink },
  field: { display: "flex", flexDirection: "column", gap: "8px" },
  label: { fontWeight: fontWeight.medium },
  input: {
    width: "100%",
    height: "40px",
    padding: "9px 12px",
    fontSize: fontSize.ui,
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    paddingTop: "16px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.ruleSoft,
  },
  error: { margin: 0, color: tokens.changeRemoved },
});
