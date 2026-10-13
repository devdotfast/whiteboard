import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import { Checkbox, Radio } from "@canvas/ui/checkbox";
import { RatingScale } from "@canvas/ui/rating-scale";
import { surfaceStyles } from "@canvas/ui/surface";
import { TextField, fieldStyles } from "@canvas/ui/text-field";
import {
  REVIEW_FEEDBACK_CAMPAIGN,
  type ReviewCanvasUi,
  type ReviewFeedback,
  type ReviewFeedbackSubmissionResult,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { createCanvasQueryClient } from "./canvas-query";
import { CourierFigure } from "./courier-figure";
import { CloseIcon } from "./icons";

type Host = NonNullable<ReviewCanvasUi["feedback"]>;

type Feature = ReviewFeedback["feature"];

function requireFeedbackSaved(result: ReviewFeedbackSubmissionResult): void {
  if (!result.ok)
    throw new Error(
      result.error === "network"
        ? "Network error. Please try again."
        : "Couldn’t send. Please try again.",
    );
}

const featureChoices: readonly (readonly [Feature, string])[] = [
  [
    "code_understanding",
    "Making it easier to understand code (e.g interactive animations, more pseudocode diffs, etc.)",
  ],
  [
    "planning_editing",
    "Help with the planning / edit-related lifecycle of code (e.g. plan mode in Whiteboard, code editing in IDE, Cursor-tab-style autocomplete)",
  ],
  [
    "collaboration",
    "Collaboration: support for giving feedback on teammates changes (e.g. syncing comments to Github)",
  ],
];

/** Shuffle once per opening; retries and answer changes keep the same order. */
function shuffledFeatures(): readonly (readonly [Feature, string])[] {
  const choices = [...featureChoices];

  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }

  return [...choices, ["other", "Other"]];
}

function ChoiceGroup<T extends string>({
  title,
  name,
  mode = "multiple",
  options,
  value,
  onChange,
  other,
  onOtherChange,
  disabled,
}: {
  title: string;
  name: string;
  mode?: "multiple" | "single";
  options: readonly (readonly [T, string])[];
  value: T[];
  onChange(value: T[]): void;
  other: string;
  onOtherChange(value: string): void;
  disabled: boolean;
}) {
  const id = useId();

  const selectOther = (key: T) => {
    if (!value.includes(key)) {
      onChange(mode === "single" ? [key] : [...value, key]);
    }
  };

  return (
    <fieldset disabled={disabled} {...stylex.props(styles.usage)}>
      <legend {...stylex.props(styles.usageLegend)}>
        <span {...stylex.props(styles.labelRow)}>
          <span {...stylex.props(styles.labelText, styles.question)}>
            {title}
          </span>
          <span {...stylex.props(styles.choiceHint)}>
            {mode === "single" ? "Choose one" : "Choose any"}
          </span>
        </span>
      </legend>
      <div
        {...stylex.props(
          styles.selectionOptions,
          mode === "multiple" && styles.multipleOptions,
        )}
      >
        {options.map(([key, label]) => (
          <div key={key} {...stylex.props(styles.selectionRow)}>
            <label
              htmlFor={`${id}-${key}`}
              {...stylex.props(
                styles.selectionLabel,
                key === "other" && styles.otherLabel,
              )}
            >
              {mode === "multiple" ? (
                <Checkbox
                  id={`${id}-${key}`}
                  name={name}
                  value={key}
                  checked={value.includes(key)}
                  required={value.length === 0 && key === options[0]?.[0]}
                  xstyle={styles.selectionCheckbox}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...value, key]
                        : value.filter((item) => item !== key),
                    )
                  }
                />
              ) : (
                <Radio
                  required
                  id={`${id}-${key}`}
                  name={name}
                  value={key}
                  checked={value.includes(key)}
                  onChange={() => onChange([key])}
                  xstyle={styles.selectionCheckbox}
                />
              )}
              <span {...stylex.props(styles.labelText)}>{label}</span>
            </label>
            {key === "other" && (
              <TextField
                variant="form"
                name={`${name}Other`}
                aria-label={`${title} Other`}
                value={other}
                maxLength={500}
                required={value.includes(key)}
                disabled={disabled}
                onClick={() => selectOther(key)}
                onChange={(event) => {
                  selectOther(key);
                  onOtherChange(event.target.value);
                }}
                xstyle={styles.other}
              />
            )}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function FeedbackDialog(props: { host: Host; onClose(): void }) {
  const [client] = useState(createCanvasQueryClient);

  return (
    <QueryClientProvider client={client}>
      <FeedbackForm {...props} />
    </QueryClientProvider>
  );
}

function FeedbackForm({ host, onClose }: { host: Host; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const emailId = useId();
  const ratingId = useId();
  const [featureOptions] = useState(shuffledFeatures);
  const [step, setStep] = useState<"survey" | "contact" | "thanks">("survey");
  const [benefit, setBenefit] = useState("");
  const [email, setEmail] = useState("");

  const [contexts, setContexts] = useState<ReviewFeedback["contexts"]>([]);

  const [contextsOther, setContextsOther] = useState("");
  const [feature, setFeature] = useState<Feature>();
  const [featureOther, setFeatureOther] = useState("");
  const [rating, setRating] = useState<number>();

  const [roles, setRoles] = useState<ReviewFeedback["roles"]>([]);

  const [rolesOther, setRolesOther] = useState("");

  const submit = useMutation({
    mutationFn: async (response: Omit<ReviewFeedback, "id">) =>
      requireFeedbackSaved(await host.submit(response)),
    onSuccess: () => setStep("contact"),
  });

  const contact = useMutation({
    mutationFn: async () =>
      requireFeedbackSaved(
        await host.submitContact({
          kind: "contact",
          campaign: REVIEW_FEEDBACK_CAMPAIGN,
          environment: host.environment ?? "production",
          email: email.trim(),
        }),
      ),
    onSuccess: () => setStep("thanks"),
  });

  const pending = submit.isPending || contact.isPending;
  const thanks = step === "thanks";

  const complete =
    contexts.length > 0 &&
    benefit.trim().length > 0 &&
    feature !== undefined &&
    rating !== undefined &&
    roles.length > 0 &&
    (!contexts.includes("other") || contextsOther.trim().length > 0) &&
    (feature !== "other" || featureOther.trim().length > 0) &&
    (!roles.includes("other") || rolesOther.trim().length > 0);

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
    heading.current?.focus();
    dialog.current?.scrollTo(0, 0);
  }, [step]);

  useLayoutEffect(() => {
    if (submit.isError || contact.isError) submitButton.current?.focus();
  }, [submit.isError, contact.isError]);

  const send = () => {
    if (
      !complete ||
      !feature ||
      rating === undefined ||
      pending ||
      step !== "survey"
    )
      return;
    submit.mutate({
      campaign: REVIEW_FEEDBACK_CAMPAIGN,
      environment: host.environment ?? "production",
      contexts,
      benefit: benefit.trim(),
      roles,
      rating,
      feature,
      ...(contexts.includes("other") &&
        contextsOther.trim() && { contextsOther: contextsOther.trim() }),
      ...(feature === "other" &&
        featureOther.trim() && { featureOther: featureOther.trim() }),
      ...(roles.includes("other") &&
        rolesOther.trim() && { rolesOther: rolesOther.trim() }),
    });
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelId}
      {...stylex.props(
        surfaceStyles.dialog,
        styles.dialog,
        step !== "survey" && styles.contactDialog,
      )}
      onCancel={(event) => {
        event.preventDefault();
        heading.current?.focus();
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        heading.current?.focus();
      }}
    >
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();

          if (step === "survey") send();
          else if (step === "contact" && email.trim() && !pending)
            contact.mutate();
        }}
      >
        <header {...stylex.props(styles.header)}>
          <h2
            id={labelId}
            ref={heading}
            tabIndex={-1}
            {...stylex.props(styles.heading)}
          >
            {step === "survey" ? "Survey" : "Thank you"}
          </h2>
          <IconButton
            aria-label="Close feedback"
            disabled={pending}
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </header>
        {step === "survey" && (
          <>
            <p {...stylex.props(styles.copy)}>
              By default, survey responses are anonymous and analyzed in
              aggregate, unless you choose to share contact information with us.
            </p>
            <ChoiceGroup
              title="In what context(s) do you use Whiteboard?"
              name="contexts"
              options={[
                ["work", "Work"],
                ["personal_projects", "Personal projects"],
                ["open_source_projects", "OSS contributions"],
                ["other", "Other"],
              ]}
              value={contexts}
              onChange={setContexts}
              other={contextsOther}
              onOtherChange={setContextsOther}
              disabled={pending}
            />
            <label {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.question)}>
                What is the main benefit you receive from Whiteboard?
              </span>
              <textarea
                name="benefit"
                aria-label="What is the main benefit you receive from Whiteboard?"
                required
                rows={1}
                maxLength={4000}
                value={benefit}
                disabled={pending}
                onChange={(event) => setBenefit(event.target.value)}
                {...stylex.props(
                  fieldStyles.box,
                  fieldStyles.form,
                  fieldStyles.multiline,
                  styles.textarea,
                )}
              />
            </label>
            <ChoiceGroup
              title="Pick one feature we should focus on to improve Whiteboard for you:"
              name="feature"
              mode="single"
              options={featureOptions}
              value={feature ? [feature] : []}
              onChange={(values) => setFeature(values[0])}
              other={featureOther}
              onOtherChange={setFeatureOther}
              disabled={pending}
            />
            <fieldset disabled={pending} {...stylex.props(styles.usage)}>
              <legend {...stylex.props(styles.usageLegend)}>
                <span {...stylex.props(styles.labelRow)}>
                  <label
                    htmlFor={ratingId}
                    {...stylex.props(styles.labelText, styles.question)}
                  >
                    On a scale from 1–5, please rate how you feel about
                    Whiteboard:
                  </label>
                  <output
                    htmlFor={ratingId}
                    aria-live="polite"
                    {...stylex.props(styles.ratingValue)}
                  >
                    {rating === undefined ? "Not rated" : `${rating}/5`}
                  </output>
                </span>
              </legend>
              <div {...stylex.props(styles.ratingScale)}>
                <span
                  id={`${ratingId}-low`}
                  {...stylex.props(styles.ratingEndpoint)}
                >
                  I don’t really like it
                </span>
                <RatingScale
                  id={ratingId}
                  value={rating}
                  onChange={setRating}
                  disabled={pending}
                  describedBy={`${ratingId}-low ${ratingId}-high`}
                />
                <span
                  id={`${ratingId}-high`}
                  {...stylex.props(styles.ratingEndpoint)}
                >
                  Whiteboard is essential
                  <br />
                  in my workflow
                </span>
              </div>
            </fieldset>
            <ChoiceGroup
              title="How would you describe yourself?"
              name="roles"
              options={[
                ["developer", "Developer"],
                ["engineering_manager", "Engineering Manager"],
                ["founder", "Founder"],
                ["other", "Other"],
              ]}
              value={roles}
              onChange={setRoles}
              other={rolesOther}
              onOtherChange={setRolesOther}
              disabled={pending}
            />
          </>
        )}
        {step === "contact" && (
          <div {...stylex.props(styles.contactSection)}>
            <p
              {...stylex.props(
                styles.copy,
                styles.primaryCopy,
                styles.contactCopy,
              )}
            >
              We’d love to hear more of your feedback, if you’re open to it.
              Could you share a good contact email? We promise we won’t be
              spammy :)
            </p>
            <div {...stylex.props(styles.emailRow)}>
              <label htmlFor={emailId}>Email</label>
              <TextField
                variant="form"
                id={emailId}
                name="email"
                aria-label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                maxLength={254}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
                xstyle={styles.email}
              />
            </div>
          </div>
        )}
        <footer {...stylex.props(styles.footer)}>
          {(step === "survey" ? submit.isError : contact.isError) && (
            <p role="alert" {...stylex.props(styles.error)}>
              {(step === "survey" ? submit.error : contact.error)?.message}
            </p>
          )}
          {thanks ? (
            <CourierFigure thinking={false} xstyle={styles.courier} />
          ) : (
            <Button
              size="large"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              Skip
            </Button>
          )}
          <div {...stylex.props(styles.actions)}>
            {thanks ? (
              <>
                <Button
                  size="large"
                  variant="ghost"
                  onClick={() => host.openReleaseNotes()}
                >
                  Release notes
                </Button>
                <Button size="large" variant="primary" onClick={onClose}>
                  Done
                </Button>
              </>
            ) : (
              <Button
                ref={submitButton}
                size="large"
                type="submit"
                variant="primary"
                loading={pending}
                aria-label={pending ? "Sending…" : undefined}
                disabled={
                  pending || (step === "survey" ? !complete : !email.trim())
                }
              >
                {step === "contact" ? "Send" : "Submit"}
              </Button>
            )}
          </div>
        </footer>
      </form>
    </dialog>
  );
}

const styles = stylex.create({
  dialog: {
    boxSizing: "border-box",
    width: "min(680px, calc(100% - 32px))",
    maxHeight: "calc(100% - 32px)",
    padding: "24px",
    scrollbarGutter: "stable",
    scrollPaddingTop: "24px",
    scrollPaddingBottom: "104px",
    "::backdrop": { backgroundColor: tokens.backdrop },
  },
  contactDialog: { width: "min(480px, calc(100% - 32px))" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    color: tokens.ink,
    fontWeight: fontWeight.regular,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  heading: {
    margin: 0,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.display,
    fontWeight: fontWeight.medium,
    outline: "none",
  },
  copy: {
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.6,
  },
  primaryCopy: { color: tokens.ink },
  question: { fontWeight: fontWeight.medium },
  usage: { margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  usageLegend: {
    boxSizing: "border-box",
    width: "100%",
    padding: "0 0 8px",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.5,
  },
  choiceHint: {
    minWidth: "64px",
    flexShrink: 0,
    textAlign: "right",
    whiteSpace: "nowrap",
    color: tokens.inkMuted,
    fontSize: fontSize.body,
  },
  ratingValue: {
    minWidth: "64px",
    textAlign: "right",
    whiteSpace: "nowrap",
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: 1.5,
    fontWeight: fontWeight.regular,
  },
  ratingScale: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(160px, 1.5fr) minmax(0, 1fr)",
    columnGap: "16px",
    alignItems: "center",
  },
  ratingEndpoint: {
    minWidth: 0,
    textAlign: "center",
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: 1.5,
  },
  selectionOptions: { display: "flex", flexDirection: "column", gap: 0 },
  multipleOptions: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 1fr)",
      "@media (max-width: 560px)": "minmax(0, 1fr)",
    },
    columnGap: "24px",
  },
  selectionRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
  },
  selectionLabel: {
    display: "inline-flex",
    boxSizing: "border-box",
    alignItems: "flex-start",
    paddingBlock: "6px",
    minHeight: "32px",
    minWidth: 0,
    maxWidth: "100%",
    whiteSpace: "normal",
    gap: "10px",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.5,
    cursor: "pointer",
  },
  selectionCheckbox: {
    marginTop: "3px",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "3px",
  },
  otherLabel: { flexShrink: 0 },
  other: {
    flex: "1 1 120px",
    minWidth: 0,
    maxWidth: "100%",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.5,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.5,
  },
  labelRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "16px",
  },
  labelText: { flex: 1, minWidth: 0 },
  textarea: {
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    fieldSizing: "content",
    width: "100%",
    minHeight: "32px",
    maxHeight: "180px",
    padding: "5px 10px",
    borderRadius: radius.control,
  },
  emailRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    gap: "12px",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.5,
  },
  email: {
    width: "100%",
  },
  contactSection: { display: "flex", flexDirection: "column", gap: "12px" },
  contactCopy: { textWrap: "pretty" },
  footer: {
    position: "sticky",
    bottom: "-24px",
    zIndex: 1,
    backgroundColor: tokens.surfaceRaised,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "12px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.ruleSoft,
    paddingTop: "16px",
    paddingBottom: "24px",
    marginBottom: "-24px",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    marginLeft: "auto",
  },
  error: {
    flex: "0 0 100%",
    color: tokens.changeRemoved,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    margin: 0,
  },
  courier: { width: "23px", height: "28px", color: tokens.accent },
});
