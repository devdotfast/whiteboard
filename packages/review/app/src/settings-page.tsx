import { Button, buttonStyles } from "@canvas/ui/button";
import { Checkbox } from "@canvas/ui/checkbox";
import { DisclosureChevron, disclosureStyles } from "@canvas/ui/disclosure";
import { focusStyles } from "@canvas/ui/focus";
import { listRowStyles } from "@canvas/ui/list-row";
import { textStyles } from "@canvas/ui/text";
import { Select, TextField } from "@canvas/ui/text-field";
import type {
  ReviewAppearance,
  ReviewCanvasSettingsContent,
  ReviewCliInstallStatus,
  ReviewColorTheme,
  ReviewColorThemeKind,
  ReviewDocumentWidthChoice,
  ReviewKeymapChoice,
  ReviewOpenFilesIn,
  ReviewOpenFilesInChoice,
  ReviewReadyNotificationChoice,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { AccountSection } from "./account-section";
import { ConnectCard, LegacySkillsRow } from "./connect-card";
import { DiffrConfigSection } from "./diffr-config-section";
import { homeStyles } from "./home-styles";
import { chevronMarker } from "./markers.stylex";
import { REMOTE_HOSTS_LABEL, RemoteHostsSection } from "./remote-hosts-section";
import {
  scrollToReviewHeading,
  useHeadingInView,
} from "./review-heading-scroll";
import { Row, Section, sectionId } from "./settings-section";
import { settingsStyles as styles } from "./settings-styles";
import { withClass } from "./stylex-props";
import { TraceCaptureSection } from "./trace-capture-section";
import { SegmentedControl, labeledOptions } from "./ui/segmented";

const COLOR_THEME_GROUPS: [ReviewColorThemeKind, string][] = [
  ["dark", "Dark"],
  ["light", "Light"],
];

const KEYMAP_LABELS: Record<ReviewKeymapChoice, string> = {
  none: "Default",
  vim: "Vim",
  emacs: "Emacs",
  sublime: "Sublime Text",
};

// The editors open at the selected line; a picked application gets the file.
const OPEN_FILES_IN_EDITORS: Record<
  Exclude<ReviewOpenFilesInChoice, "application">,
  string
> = {
  whiteboard: "Whiteboard",
  vscode: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
};

const CHOOSE_APPLICATION = "choose";

const DOCUMENT_WIDTH_LABELS: Record<ReviewDocumentWidthChoice, string> = {
  standard: "Standard",
  wide: "Wide",
  full: "Full",
};

const READING_FONT_LABELS: Record<ReviewAppearance["readingFont"], string> = {
  serif: "Serif",
  sans: "Sans",
};

const DOCUMENT_FONT_SIZES = [13, 14, 15, 16, 17, 18, 20];

const CODE_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18];

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
  const [diffTheme, setDiffTheme] = useState(settings.diffTheme);
  const [colorThemes, setColorThemes] = useState(settings.colorThemes);
  const [keymap, setKeymap] = useState(settings.keymap);
  const [openFilesIn, setOpenFilesIn] = useState(settings.openFilesIn);
  const [documentWidth, setDocumentWidth] = useState(settings.documentWidth);
  const [appearance, setAppearance] = useState(settings.appearance);

  const [readyNotification, setReadyNotification] = useState(
    settings.readyNotification,
  );

  const [softwareMapEnabled, setSoftwareMapEnabled] = useState(
    settings.softwareMapEnabled,
  );

  const [showReleaseNotes, setShowReleaseNotes] = useState(
    settings.showReleaseNotes,
  );

  const [animationsEnabled, setAnimationsEnabled] = useState(
    settings.animationsEnabled,
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

  // Syntax colors follow Theme, so the Diff tab only takes a theme of its
  // kind; Desktop ignores a saved one of the other kind.
  const themeKind = colorThemes.find((option) => option.id === theme)?.kind;

  const diffThemes = colorThemes.filter(
    (option) => !themeKind || option.kind === themeKind,
  );

  const shownDiffTheme = diffThemes.some((option) => option.id === diffTheme)
    ? diffTheme
    : "";

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);

  const agents = Boolean(install);
  const commandLine = Boolean(install?.status.cli);

  const contents = useMemo(
    () =>
      [
        "Account",
        ...(agents ? ["Agents"] : []),
        ...(commandLine ? ["Command line"] : []),
        "Privacy",
        "Appearance",
        "Editor",
        "Notifications",
        "Tools",
        REMOTE_HOSTS_LABEL,
        "Experimental Features",
        "Uninstall",
      ].map((label) => ({
        id: sectionId(label),
        text: label.replace(" (Experimental)", ""),
      })),
    [agents, commandLine],
  );

  const changeAppearance = <Key extends keyof ReviewAppearance>(
    key: Key,
    value: ReviewAppearance[Key],
  ) => void run(() => settings.setAppearance(key, value), setAppearance);

  return (
    <main {...withClass("review-home", homeStyles.page)}>
      <div ref={scrollRef} {...stylex.props(homeStyles.scroll, styles.scroll)}>
        <div {...stylex.props(homeStyles.content, styles.layout)}>
          <SettingsContents
            entries={contents}
            columnRef={columnRef}
            scrollRef={scrollRef}
          />
          <div ref={columnRef} {...stylex.props(styles.page)}>
            <div {...stylex.props(homeStyles.header)}>
              <h1 {...stylex.props(homeStyles.heading)}>Settings</h1>
            </div>
            <p {...stylex.props(styles.lede)}>
              Settings apply to Whiteboard on this machine.
            </p>

            <AccountSection request={settings.request} />

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
                  {install.status.shim.installed ||
                  install.status.shim.installer ? null : (
                    <Button
                      disabled={installingCli}
                      onClick={async () => {
                        setInstallingCli(true);
                        await run(
                          () => install.apply({ shim: true }),
                          setInstallStatus,
                        );
                        setInstallingCli(false);
                      }}
                    >
                      Install
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

            <Section label="Appearance">
              <Row label="Theme" description="How Whiteboard looks.">
                <ThemeSelect
                  label="Theme"
                  themes={colorThemes}
                  value={theme}
                  onChange={(id) =>
                    void run(() => settings.setTheme(id), setTheme)
                  }
                />
              </Row>
              <Row
                label="Diff theme"
                description="Backgrounds and change colors in the Diff tab. Lists themes as light or dark as Theme."
              >
                <ThemeSelect
                  label="Diff theme"
                  themes={diffThemes}
                  value={shownDiffTheme}
                  followsTheme
                  onChange={(id) =>
                    void run(() => settings.setDiffTheme(id), setDiffTheme)
                  }
                />
              </Row>
              <Row
                label="Import a theme"
                description="A VS Code theme extension (.vsix) or theme file (.json)."
              >
                <Button
                  onClick={() =>
                    void run(
                      () => settings.importColorTheme(),
                      (imported) => {
                        if (!imported) return;
                        setColorThemes(imported.colorThemes);
                        setTheme(imported.theme);
                      },
                    )
                  }
                >
                  Choose file…
                </Button>
              </Row>
              <Row
                label="Expand diagrams on click"
                description="Open inline diagrams fullscreen when selecting a node. When off, select the node and open its sidebar."
              >
                <label {...stylex.props(styles.toggle)}>
                  <Checkbox
                    aria-label="Expand diagrams on click"
                    checked={appearance.diagramFullscreenOnClick}
                    onChange={(event) =>
                      changeAppearance(
                        "diagramFullscreenOnClick",
                        event.target.checked,
                      )
                    }
                  />
                </label>
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
              <div {...stylex.props(styles.nested)}>
                <details>
                  <summary
                    {...stylex.props(
                      chevronMarker,
                      disclosureStyles.toggle,
                      focusStyles.ring,
                      styles.nestedSummary,
                    )}
                  >
                    <DisclosureChevron />
                    Specifics
                  </summary>
                  <Row
                    label="Text size"
                    description="Whiteboard text. Headings scale with it."
                  >
                    <SizeSelect
                      label="Text size"
                      sizes={DOCUMENT_FONT_SIZES}
                      value={appearance.documentFontSize}
                      onChange={(size) =>
                        changeAppearance("documentFontSize", size)
                      }
                    />
                  </Row>
                  <Row
                    label="Reading typeface"
                    description="Whiteboard text, Ask answers, and trace notes."
                  >
                    <SegmentedControl
                      label="Reading typeface"
                      value={appearance.readingFont}
                      options={labeledOptions(READING_FONT_LABELS)}
                      onChange={(choice) =>
                        changeAppearance("readingFont", choice)
                      }
                    />
                  </Row>
                  <Row
                    label="Reading font"
                    description="Any installed font for reading text. Clear it to use the typeface above."
                  >
                    <FontFamilyField
                      label="Reading font"
                      value={appearance.readingFontFamily}
                      onChange={(family) =>
                        changeAppearance("readingFontFamily", family)
                      }
                    />
                  </Row>
                  <Row
                    label="Code font"
                    description="Code blocks, diffs, peeks, and source tabs. Clear it for Geist Mono."
                  >
                    <FontFamilyField
                      label="Code font"
                      value={appearance.codeFontFamily}
                      onChange={(family) =>
                        changeAppearance("codeFontFamily", family)
                      }
                    />
                  </Row>
                  <Row
                    label="Code font size"
                    description="Code blocks and source tabs."
                  >
                    <SizeSelect
                      label="Code font size"
                      sizes={CODE_FONT_SIZES}
                      value={appearance.codeFontSize}
                      onChange={(size) =>
                        changeAppearance("codeFontSize", size)
                      }
                    />
                  </Row>
                  <Row
                    label="Font ligatures"
                    description="Code blocks, diffs, peeks, and source tabs."
                  >
                    <label {...stylex.props(styles.toggle)}>
                      <Checkbox
                        aria-label="Font ligatures"
                        checked={appearance.fontLigatures}
                        onChange={(event) =>
                          changeAppearance(
                            "fontLigatures",
                            event.target.checked,
                          )
                        }
                      />
                    </label>
                  </Row>
                  <Row
                    label="Diff font size"
                    description="The Diff tab, diff blocks, and code peeks."
                  >
                    <SizeSelect
                      label="Diff font size"
                      sizes={CODE_FONT_SIZES}
                      value={appearance.diffFontSize}
                      onChange={(size) =>
                        changeAppearance("diffFontSize", size)
                      }
                    />
                  </Row>
                  <Row
                    label="Wrap long lines in diffs"
                    description="The Diff tab and diff blocks."
                  >
                    <label {...stylex.props(styles.toggle)}>
                      <Checkbox
                        aria-label="Wrap long lines in diffs"
                        checked={appearance.diffWordWrap}
                        onChange={(event) =>
                          changeAppearance("diffWordWrap", event.target.checked)
                        }
                      />
                    </label>
                  </Row>
                  <Row
                    label="Hide whitespace changes"
                    description="Leading and trailing whitespace, in diffs and peeks."
                  >
                    <label {...stylex.props(styles.toggle)}>
                      <Checkbox
                        aria-label="Hide whitespace changes"
                        checked={appearance.diffIgnoreWhitespace}
                        onChange={(event) =>
                          changeAppearance(
                            "diffIgnoreWhitespace",
                            event.target.checked,
                          )
                        }
                      />
                    </label>
                  </Row>
                </details>
              </div>
            </Section>

            <Section label="Editor">
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
              <Row
                label="Release notes"
                description="Show what's new on the first launch after an update."
              >
                <label {...stylex.props(styles.toggle)}>
                  <Checkbox
                    aria-label="Release notes"
                    checked={showReleaseNotes}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void run(
                        () => settings.setShowReleaseNotes(enabled),
                        setShowReleaseNotes,
                      );
                    }}
                  />
                </label>
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
                label="Animations"
                description="Let agents create and edit animations through MCP. Existing animations remain visible when off."
              >
                <label {...stylex.props(styles.toggle)}>
                  <Checkbox
                    aria-label="Animations"
                    checked={animationsEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void run(
                        () => settings.setAnimationsEnabled(enabled),
                        setAnimationsEnabled,
                      );
                    }}
                  />
                </label>
              </Row>
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
                label="Open files in"
                description="Where Open file sends a file. Diffs stay in Whiteboard."
              >
                <OpenFilesInSelect
                  value={openFilesIn}
                  onChoose={() =>
                    void run(
                      () => settings.chooseOpenFilesInApplication(),
                      setOpenFilesIn,
                    )
                  }
                  onChange={(choice) =>
                    void run(
                      () => settings.setOpenFilesIn(choice),
                      setOpenFilesIn,
                    )
                  }
                />
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

            {error ? (
              <p {...stylex.props(textStyles.error, styles.error)}>{error}</p>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function SettingsContents({
  entries,
  columnRef,
  scrollRef,
}: {
  entries: { id: string; text: string }[];
  columnRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const current = useHeadingInView(entries, columnRef, scrollRef, true);

  return (
    <nav aria-label="Settings contents" {...stylex.props(styles.toc)}>
      {entries.map(({ id, text }) => (
        <button
          key={id}
          type="button"
          aria-current={id === current ? "location" : undefined}
          {...stylex.props(
            focusStyles.ringInset,
            buttonStyles.reset,
            listRowStyles.row,
            listRowStyles.wash,
            id === current && listRowStyles.current,
          )}
          onClick={() =>
            scrollToReviewHeading(id, columnRef.current, scrollRef.current)
          }
        >
          {text}
        </button>
      ))}
    </nav>
  );
}

// A size set elsewhere, such as one imported from VS Code, gets its own option.
function SizeSelect({
  label,
  sizes,
  value,
  onChange,
}: {
  label: string;
  sizes: number[];
  value: number;
  onChange: (size: number) => void;
}) {
  return (
    <Select
      aria-label={label}
      value={String(value)}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    >
      {[...new Set([...sizes, value])]
        .sort((left, right) => left - right)
        .map((size) => (
          <option key={size} value={size}>
            {size}px
          </option>
        ))}
    </Select>
  );
}

function FontFamilyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (family: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft.trim() !== value) onChange(draft.trim());
  };

  return (
    <TextField
      aria-label={label}
      spellCheck={false}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function ThemeSelect({
  label,
  themes,
  value,
  followsTheme = false,
  onChange,
}: {
  label: string;
  themes: ReviewColorTheme[];
  value: string;
  /** Offers "Same as Theme", whose id is "". */
  followsTheme?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {followsTheme ? <option value="">Same as Theme</option> : null}
      {COLOR_THEME_GROUPS.map(([kind, label]) => {
        const options = themes.filter((option) => option.kind === kind);

        return options.length ? (
          <optgroup key={kind} label={label}>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </Select>
  );
}

function OpenFilesInSelect({
  value,
  onChoose,
  onChange,
}: {
  value: ReviewOpenFilesIn;
  onChoose: () => void;
  onChange: (choice: ReviewOpenFilesInChoice) => void;
}) {
  return (
    <Select
      aria-label="Open files in"
      title={value.application?.path}
      value={value.choice}
      onChange={(event) => {
        const next = event.currentTarget.value;

        if (next === CHOOSE_APPLICATION) return onChoose();

        // SAFETY: every other option's value is a ReviewOpenFilesInChoice.
        onChange(next as ReviewOpenFilesInChoice);
      }}
    >
      {Object.entries(OPEN_FILES_IN_EDITORS).map(([choice, label]) => (
        <option key={choice} value={choice}>
          {label}
        </option>
      ))}
      {value.application ? (
        <option value="application">{value.application.name}</option>
      ) : null}
      <option value={CHOOSE_APPLICATION}>
        {value.application
          ? "Choose another application…"
          : "Choose application…"}
      </option>
    </Select>
  );
}
