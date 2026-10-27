import { fontSize, fontWeight, radius, space } from "@canvas/scale.stylex";
import { GitHubIcon } from "@canvas/ui/brand-icons";
import { Button } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { MailIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import type { ReviewCanvasSettingsContent } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { createCanvasQueryClient } from "./canvas-query";
import { hostApiClient } from "./host/review-session";
import { Row, Section } from "./settings-section";
import { settingsStyles } from "./settings-styles";
import { useSharingAccount, useSignIn, useSignOut } from "./sharing-account";
import { tokens } from "./tokens.stylex";

export function AccountSection({
  request,
}: Pick<ReviewCanvasSettingsContent, "request">) {
  const [queryClient] = useState(createCanvasQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <Account request={request} />
    </QueryClientProvider>
  );
}

function Account({ request }: Pick<ReviewCanvasSettingsContent, "request">) {
  const client = useMemo(() => hostApiClient({ request }), [request]);
  const accountQuery = useSharingAccount(client);
  const signIn = useSignIn(client);
  const signOut = useSignOut(client);
  const state = accountQuery.data;
  const pending = state?.pending ?? false;

  const signedIn = state?.account;
  const name = signedIn?.githubLogin ?? signedIn?.email ?? signedIn?.login;

  const failure =
    (signIn.error ?? signOut.error)?.message ??
    (accountQuery.isError ? "Could not read sign-in status." : state?.error);

  return (
    <Section label="Account">
      {!state ? null : signedIn ? (
        <div {...stylex.props(settingsStyles.row)}>
          <div {...stylex.props(styles.identity)}>
            <span aria-hidden="true" {...stylex.props(styles.avatar)}>
              {name?.charAt(0).toUpperCase()}
            </span>
            <div {...stylex.props(settingsStyles.rowText)}>
              <span {...stylex.props(settingsStyles.rowLabel)}>{name}</span>
              <span
                {...stylex.props(settingsStyles.rowDescription, styles.method)}
              >
                {signedIn.githubLogin ? (
                  <>
                    <GitHubIcon xstyle={iconStyles.inline} />
                    Signed in with GitHub
                  </>
                ) : signedIn.email ? (
                  <>
                    <MailIcon xstyle={iconStyles.inline} />
                    Signed in with email
                  </>
                ) : (
                  "Signed in"
                )}
              </span>
            </div>
          </div>
          <div {...stylex.props(settingsStyles.rowControl)}>
            <Button onClick={() => signOut.mutate()}>Sign out</Button>
          </div>
        </div>
      ) : (
        <Row
          label="Not signed in"
          description={
            pending
              ? state.userCode
                ? `Confirm code ${state.userCode} in your browser.`
                : "Finish signing in in your browser."
              : "Sign in to share whiteboards."
          }
        >
          <Button
            variant="primary"
            aria-busy={pending || undefined}
            onClick={() => {
              if (!pending && !signIn.isPending) signIn.mutate();
            }}
          >
            {pending ? "Waiting for sign-in…" : "Sign in"}
          </Button>
        </Row>
      )}
      {failure ? (
        <p
          role="alert"
          {...stylex.props(textStyles.error, settingsStyles.error)}
        >
          {failure}
        </p>
      ) : null}
    </Section>
  );
}

const styles = stylex.create({
  identity: {
    display: "flex",
    alignItems: "center",
    gap: space.s12,
    minWidth: 0,
  },
  avatar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: space.s28,
    height: space.s28,
    borderRadius: radius.round,
    backgroundColor: tokens.well,
    color: tokens.inkMuted,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  method: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
  },
});
