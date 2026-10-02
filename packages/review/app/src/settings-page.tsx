import { Button } from "@canvas/ui/button";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewCanvasSettingsContent,
  ReviewCliInstallStatus,
  ReviewCtrlTabChoice,
  ReviewDocumentWidthChoice,
  ReviewKeymapChoice,
  ReviewReadyNotificationChoice,
  ReviewThemeChoice,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useState } from "react";

import { ConnectCard, LegacySkillsRow } from "./connect-card";
import { DiffrConfigSection } from "./diffr-config-section";
import { homeStyles } from "./home-styles";
import { RemoteHostsSection } from "./remote-hosts-section";
import { Choice } from "./settings-choice";
import { settingsStyles as styles } from "./settings-styles";
import { withClass } from "./stylex-props";
import { TraceCaptureSection } from "./trace-capture-section";

const THEME_LABELS: Record<ReviewThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const KEYMAP_LABELS: Record<ReviewKeymapChoice, string> = {
  none: "Default",
  vim: "Vim",
  emacs: "Emacs",
  sublime: "Sublime Text",
};

const CTRL_TAB_LABELS: Record<ReviewCtrlTabChoice, string> = {
  recent: "Last used tab",
  next: "Next tab",
};

const DOCUMENT_WIDTH_LABELS: Record<ReviewDocumentWidthChoice, string> = {
  standard: "Standard",
  wide: "Wide",
  full: "Full",
};

const READY_NOTIFICATION_LABELS: Record<ReviewReadyNotificationChoice, string> =
  {
    notificationAndBadge: "Notification and badge",
    notification: "Notification only",
    off: "Off",
  };

/**
 * The Settings page. It opens from the application menu (Preferences →
 * Settings...), the command palette, or ⌘,. Reuses the Home page shell so the
 * surfaces read as one app.
 *
 * The workbench owns every value here. Each setter resolves with the value that
 * landed, so a row shows the real state rather than an optimistic one.
 */
export function SettingsPage({
  settings,
}: {
  settings: ReviewCanvasSettingsContent;
}) {
  const [telemetryEnabled, setTelemetryEnabled] = useState(
    settings.telemetryEnabled,
  );

  const [theme, setTheme] = useState(settings.theme);
  const [keymap, setKeymap] = useState(settings.keymap);
  const [ctrlTab, setCtrlTab] = useState(settings.ctrlTab);
  const [documentWidth, setDocumentWidth] = useState(settings.documentWidth);

  const [readyNotification, setReadyNotification] = useState(
    settings.readyNotification,
  );

  const [softwareMapEnabled, setSoftwareMapEnabled] = useState(
    settings.softwareMapEnabled,
  );

  const [structuralDiffEnabled, setStructuralDiffEnabled] = useState(
    settings.structuralDiffEnabled,
  );

  const [scratchpadEnabled, setScratchpadEnabled] = useState(
    settings.scratchpadEnabled,
  );

  const [installStatus, setInstallStatus] = useState<
    ReviewCliInstallStatus | undefined
  >(settings.install?.status);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => setInstallStatus(settings.install?.status),
    [settings.install?.status],
  );

  const install =
    settings.install && installStatus
      ? { ...settings.install, status: installStatus }
      : settings.install;

  const run = async <T,>(
    key: string,
    action: () => Promise<T>,
    adopt: (value: T) => void,
  ) => {
    setBusy(key);
    setError(null);

    try {
      adopt(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main {...withClass("review-home", homeStyles.page)}>
      <div {...stylex.props(homeStyles.scroll)}>
        <div {...stylex.props(homeStyles.content, styles.page)}>
          <div {...stylex.props(homeStyles.header)}>
            <h1 {...stylex.props(homeStyles.heading)}>Settings</h1>
          </div>
          <p {...stylex.props(styles.lede)}>
            Settings apply to Whiteboard on this machine.
          </p>

          {install ? (
            <Section label="Agents">
              <LegacySkillsRow
                install={install}
                onStatusChange={setInstallStatus}
              />
              <ConnectCard install={install} />
            </Section>
          ) : null}

          {install?.status.cli ? (
            <Section label="Command line">
              <Row
                label="whiteboard command"
                description={
                  install.status.shim.installed
                    ? `Installed at ${install.status.shim.path}. Your agents and trace capture run it.`
                    : "Adds whiteboard to your shell PATH. Your agents and trace capture run it."
                }
              >
                {install.status.shim.installer ? null : (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        "command",
                        () =>
                          install.status.shim.installed
                            ? install.remove({ shim: true })
                            : install.apply({ shim: true }),
                        setInstallStatus,
                      )
                    }
                  >
                    {install.status.shim.installed ? "Remove" : "Install"}
                  </Button>
                )}
              </Row>
            </Section>
          ) : null}

          <Section label="Privacy">
            <Row
              label="Share anonymous usage data"
              description="Counts and timings only. Never code, file paths, or repository names."
            >
              <label
                {...stylex.props(styles.toggle)}
                aria-label="Share anonymous usage data"
              >
                <input
                  {...stylex.props(styles.checkbox)}
                  type="checkbox"
                  checked={telemetryEnabled}
                  disabled={busy !== null}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
                      "telemetry",
                      () => settings.setTelemetryEnabled(enabled),
                      setTelemetryEnabled,
                    );
                  }}
                />
              </label>
            </Row>
          </Section>

          <Section label="Editor">
            <Row label="Theme" description="How Whiteboard looks.">
              <Choice
                label="Theme"
                value={theme}
                labels={THEME_LABELS}
                disabled={busy !== null}
                onChange={(choice) =>
                  void run("theme", () => settings.setTheme(choice), setTheme)
                }
              />
            </Row>
            <Row
              label="Document width"
              description="Wide and Full give diagrams and code more room. Text keeps a reading width."
            >
              <Choice
                label="Document width"
                value={documentWidth}
                labels={DOCUMENT_WIDTH_LABELS}
                disabled={busy !== null}
                onChange={(choice) =>
                  void run(
                    "document-width",
                    () => settings.setDocumentWidth(choice),
                    setDocumentWidth,
                  )
                }
              />
            </Row>
            <Row
              label="Keymap"
              description="Vim, Emacs, and Sublime Text keys come from a bundled extension. A change needs a reload."
            >
              <Choice
                label="Keymap"
                value={keymap}
                labels={KEYMAP_LABELS}
                disabled={busy !== null}
                onChange={(choice) => {
                  void run(
                    "keymap",
                    () => settings.setKeymap(choice),
                    setKeymap,
                  );
                }}
              />
            </Row>
            <Row
              label="Ctrl+Tab"
              description="Jump back to the last used tab, or step through the tab bar."
            >
              <Choice
                label="Ctrl+Tab"
                value={ctrlTab}
                labels={CTRL_TAB_LABELS}
                disabled={busy !== null}
                onChange={(choice) =>
                  void run(
                    "ctrl-tab",
                    () => settings.setCtrlTab(choice),
                    setCtrlTab,
                  )
                }
              />
            </Row>
          </Section>

          <Section label="Notifications">
            <Row
              label="Review ready"
              description="When an agent finishes a review you aren't looking at."
            >
              <Choice
                label="Review ready"
                value={readyNotification}
                labels={READY_NOTIFICATION_LABELS}
                disabled={busy !== null}
                onChange={(choice) =>
                  void run(
                    "ready-notification",
                    () => settings.setReadyNotification(choice),
                    setReadyNotification,
                  )
                }
              />
            </Row>
          </Section>

          <Section label="Tools">
            <Row
              label="Extensions"
              description="Install or turn on language extensions."
            >
              <Button onClick={settings.manageExtensions}>Manage…</Button>
            </Row>
          </Section>

          {settings.remoteHosts.enabled ? (
            <RemoteHostsSection hosts={settings.remoteHosts} />
          ) : null}

          <Section label="Experimental Features">
            <Row
              label="Structural Diffs"
              description="Replace the standard diff view with syntax-aware diffs and linked folds."
            >
              <label {...stylex.props(styles.toggle)}>
                <input
                  {...stylex.props(styles.checkbox)}
                  type="checkbox"
                  aria-label="Structural Diffs"
                  checked={structuralDiffEnabled}
                  disabled={busy !== null}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
                      "structural-diff",
                      () => settings.setStructuralDiffEnabled(enabled),
                      setStructuralDiffEnabled,
                    );
                  }}
                />
              </label>
            </Row>
            {structuralDiffEnabled ? (
              <DiffrConfigSection
                actions={settings.diffrConfig}
                reloadWindow={settings.reloadWindow}
              />
            ) : null}
            <Row
              label="Software Map"
              description="Show the experimental Software Map view in sessions."
            >
              <label {...stylex.props(styles.toggle)}>
                <input
                  {...stylex.props(styles.checkbox)}
                  type="checkbox"
                  aria-label="Software Map"
                  checked={softwareMapEnabled}
                  disabled={busy !== null}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
                      "software-map",
                      () => settings.setSoftwareMapEnabled(enabled),
                      setSoftwareMapEnabled,
                    );
                  }}
                />
              </label>
            </Row>
            <Row
              label="Scratchpad"
              description="Show the experimental scratchpad on Home. Agents draw on it through Whiteboard's MCP tools."
            >
              <label {...stylex.props(styles.toggle)}>
                <input
                  {...stylex.props(styles.checkbox)}
                  type="checkbox"
                  aria-label="Scratchpad"
                  checked={scratchpadEnabled}
                  disabled={busy !== null}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
                      "scratchpad",
                      () => settings.setScratchpadEnabled(enabled),
                      setScratchpadEnabled,
                    );
                  }}
                />
              </label>
            </Row>
            {install ? (
              <TraceCaptureSection
                install={install}
                onStatusChange={setInstallStatus}
              />
            ) : null}
          </Section>

          {error ? <p {...stylex.props(styles.error)}>{error}</p> : null}
        </div>
      </div>
    </main>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section {...stylex.props(styles.section)} aria-label={label}>
      <h2 {...stylex.props(textStyles.eyebrow, styles.sectionLabel)}>
        {label}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowText)}>
        <span {...stylex.props(styles.rowLabel)}>{label}</span>
        <span {...stylex.props(styles.rowDescription)}>{description}</span>
      </div>
      <div {...stylex.props(styles.rowControl)}>{children}</div>
    </div>
  );
}
