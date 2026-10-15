import { Button } from "@canvas/ui/button";
import { Checkbox } from "@canvas/ui/checkbox";
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
import { useEffect, useState } from "react";

import { ConnectCard, LegacySkillsRow } from "./connect-card";
import { DiffrConfigSection } from "./diffr-config-section";
import { homeStyles } from "./home-styles";
import { RemoteHostsSection } from "./remote-hosts-section";
import { Row, Section } from "./settings-section";
import { settingsStyles as styles } from "./settings-styles";
import { withClass } from "./stylex-props";
import { TraceCaptureSection } from "./trace-capture-section";
import { SegmentedControl, labeledOptions } from "./ui/segmented";

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

const CODE_FONT_SIZES = [11, 12, 13, 14, 16];

// A size set elsewhere, such as one imported from VS Code, gets its own segment.
function codeFontSizeLabels(current: number) {
  const sizes = [...new Set([...CODE_FONT_SIZES, current])].sort(
    (left, right) => left - right,
  );

  return Object.fromEntries(sizes.map((size) => [String(size), String(size)]));
}

const READY_NOTIFICATION_LABELS: Record<ReviewReadyNotificationChoice, string> =
  {
    notificationAndBadge: "Notification and badge",
    notification: "Notification only",
    off: "Off",
  };

/**
 * The Settings page. It opens from the application menu (Settings...), the
 * command palette, or ⌘,. Reuses the Home page shell so the surfaces read as
 * one app.
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
  const [codeFontSize, setCodeFontSize] = useState(settings.codeFontSize);

  const [readyNotification, setReadyNotification] = useState(
    settings.readyNotification,
  );

  const [softwareMapEnabled, setSoftwareMapEnabled] = useState(
    settings.softwareMapEnabled,
  );

  const [scratchpadEnabled, setScratchpadEnabled] = useState(
    settings.scratchpadEnabled,
  );

  const [installStatus, setInstallStatus] = useState<
    ReviewCliInstallStatus | undefined
  >(settings.install?.status);

  const [installingCli, setInstallingCli] = useState(false);
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
    action: () => Promise<T>,
    adopt: (value: T) => void,
  ) => {
    setError(null);

    try {
      adopt(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
              <div {...stylex.props(styles.connect)}>
                <ConnectCard install={install} />
              </div>
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
                    disabled={installingCli}
                    onClick={async () => {
                      setInstallingCli(true);
                      await run(
                        () =>
                          install.status.shim.installed
                            ? install.remove({ shim: true })
                            : install.apply({ shim: true }),
                        setInstallStatus,
                      );
                      setInstallingCli(false);
                    }}
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
                <Checkbox
                  checked={telemetryEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
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
              <SegmentedControl
                label="Theme"
                value={theme}
                options={labeledOptions(THEME_LABELS)}
                onChange={(choice) =>
                  void run(() => settings.setTheme(choice), setTheme)
                }
              />
            </Row>
            <Row
              label="Document width"
              description="Wide and Full give diagrams and code more room. Text keeps a reading width."
            >
              <SegmentedControl
                label="Document width"
                value={documentWidth}
                options={labeledOptions(DOCUMENT_WIDTH_LABELS)}
                onChange={(choice) =>
                  void run(
                    () => settings.setDocumentWidth(choice),
                    setDocumentWidth,
                  )
                }
              />
            </Row>
            <Row
              label="Code font size"
              description="Text size in diffs, code peeks, and source tabs."
            >
              <SegmentedControl
                label="Code font size"
                value={String(codeFontSize)}
                options={labeledOptions(codeFontSizeLabels(codeFontSize))}
                onChange={(choice) =>
                  void run(
                    () => settings.setCodeFontSize(Number(choice)),
                    setCodeFontSize,
                  )
                }
              />
            </Row>
            <Row
              label="Keymap"
              description="Vim, Emacs, and Sublime Text keys come from a bundled extension. A change needs a reload."
            >
              <SegmentedControl
                label="Keymap"
                value={keymap}
                options={labeledOptions(KEYMAP_LABELS)}
                onChange={(choice) => {
                  void run(() => settings.setKeymap(choice), setKeymap);
                }}
              />
            </Row>
            <Row
              label="Ctrl+Tab"
              description="Jump back to the last used tab, or step through the tab bar."
            >
              <SegmentedControl
                label="Ctrl+Tab"
                value={ctrlTab}
                options={labeledOptions(CTRL_TAB_LABELS)}
                onChange={(choice) =>
                  void run(() => settings.setCtrlTab(choice), setCtrlTab)
                }
              />
            </Row>
          </Section>

          <Section label="Notifications">
            <Row
              label="Review ready"
              description="When an agent finishes a review you aren't looking at."
            >
              <SegmentedControl
                label="Review ready"
                value={readyNotification}
                options={labeledOptions(READY_NOTIFICATION_LABELS)}
                onChange={(choice) =>
                  void run(
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
            <Row
              label="VS Code settings"
              description="Copy settings and keybindings from VS Code or Cursor again. Replaces Whiteboard's."
            >
              <Button onClick={settings.importVsCodeSettings}>Import…</Button>
            </Row>
            <DiffrConfigSection
              actions={settings.diffrConfig}
              reloadWindow={settings.reloadWindow}
            />
          </Section>

          <RemoteHostsSection hosts={settings.remoteHosts} />

          <Section label="Experimental Features">
            <Row
              label="Software Map"
              description="Show the experimental Software Map view in sessions."
            >
              <label {...stylex.props(styles.toggle)}>
                <Checkbox
                  aria-label="Software Map"
                  checked={softwareMapEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
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
                <Checkbox
                  aria-label="Scratchpad"
                  checked={scratchpadEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(
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

          <Section label="Uninstall">
            <Row
              label="Uninstall Whiteboard"
              description="Removes the whiteboard command and trace setup. Your sessions stay on disk."
            >
              <Button onClick={settings.uninstallApp}>Uninstall…</Button>
            </Row>
          </Section>

          {error ? <p {...stylex.props(styles.error)}>{error}</p> : null}
        </div>
      </div>
    </main>
  );
}
