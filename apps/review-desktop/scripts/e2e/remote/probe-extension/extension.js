// Test only. Installed on a wb-test remote by `remote.mjs install-extension`.
// On activation it attempts, in turn, each action the guard (Stage 2, Task 7)
// must block on the laptop, then one action it must allow, and appends one line
// per action to a log file: "<action>: refused: <message>" or
// "<action>: ALLOWED". Task 9's journey reuses it. The log goes to
// $WB_PROBE_LOG_DIR/probe.log when set, else to the extension's global-storage
// folder on the remote (printed on the first line).
const fs = require("node:fs");

const path = require("node:path");

const vscode = require("vscode");

// An action that must be refused: the guard rejects it, and the log records
// "refused". A success is a breach ("NOT REFUSED").
async function refuses(name, attempt, log) {
  try {
    const note = await attempt();
    log(`${name}: NOT REFUSED${note ? ` (${note})` : ""}`);
  } catch (error) {
    log(`${name}: refused: ${message(error)}`);
  }
}

// An action whose outcome is only recorded, not asserted (its safety is checked
// on the laptop, or the window log holds the guard's refusal for a fire-and-
// forget call the extension cannot observe).
async function observe(name, attempt, log) {
  try {
    log(`${name}: ${(await attempt()) || "ok"}`);
  } catch (error) {
    log(`${name}: threw: ${message(error)}`);
  }
}

function message(error) {
  return String((error && error.message) || error).replace(/\s+/g, " ");
}

// A URI that reaches the window as the given scheme even after the extension
// host's URI transformer runs: revive() keeps a plain scheme/path as is.
function windowUri(scheme, fsPath) {
  return vscode.Uri.from({ scheme, path: fsPath });
}

// The window's editor on one of this remote's own files, if the check opens
// one within 15 s: only those reach this extension host.
async function ownEditor() {
  for (let i = 0; i < 30 && !vscode.window.visibleTextEditors.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 500));

  return vscode.window.visibleTextEditors[0];
}

function readConfig(context) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(context.extensionPath, "probe-config.json"),
        "utf8",
      ),
    );
  } catch {
    return {};
  }
}

async function run(context) {
  const dir = process.env.WB_PROBE_LOG_DIR || context.globalStorageUri.fsPath;
  const logFile = path.join(dir, "probe.log");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(logFile, `log: ${logFile}\n`);
  const log = (line) => fs.appendFileSync(logFile, `${line}\n`);

  const localHosts = windowUri("vscode-local", "/etc/hosts");
  const fileHosts = windowUri("file", "/etc/hosts");
  // The other remote's authority is only known after the window connects, so
  // the harness drops a probe-config.json into this folder before activation.
  const config = readConfig(context);

  const otherAuthority =
    process.env.WB_PROBE_OTHER_AUTHORITY || config.otherAuthority;

  // 1. Read the laptop's /etc/hosts. From a remote extension, vscode-local: is
  // the laptop; file: is the remote's own disk (its transformer keeps it here),
  // so reading file: is not a laptop breach and is expected to succeed.
  await refuses(
    "read vscode-local:/etc/hosts",
    async () => {
      const bytes = await vscode.workspace.fs.readFile(localHosts);

      return `${bytes.length} bytes`;
    },
    log,
  );
  await observe(
    "read file:///etc/hosts (the remote's own disk, not the laptop)",
    async () => {
      const bytes = await vscode.workspace.fs.readFile(fileHosts);

      return `${bytes.length} bytes from the remote`;
    },
    log,
  );

  // 2. Read a file on the other remote's authority.
  if (otherAuthority) {
    await refuses(
      "read the other remote's /etc/hosts",
      async () => {
        const bytes = await vscode.workspace.fs.readFile(
          vscode.Uri.parse(`vscode-remote://${otherAuthority}/etc/hosts`),
        );

        return `${bytes.length} bytes`;
      },
      log,
    );
  } else {
    log(
      "read the other remote's /etc/hosts: SKIPPED (no WB_PROBE_OTHER_AUTHORITY)",
    );
  }

  // 3. Open a file: link with the operating system.
  await refuses(
    "openExternal file:///tmp/wb-probe-marker.command",
    async () => {
      const opened = await vscode.env.openExternal(
        windowUri("file", "/tmp/wb-probe-marker.command"),
      );

      return `returned ${opened}`;
    },
    log,
  );

  // 4. Run a window command that opens a folder on the laptop.
  await refuses(
    "executeCommand vscode.openFolder",
    () => vscode.commands.executeCommand("vscode.openFolder", fileHosts),
    log,
  );

  // 5. Read and write the laptop clipboard.
  await refuses(
    "clipboard.readText",
    async () => {
      const text = await vscode.env.clipboard.readText();

      return `${text.length} chars`;
    },
    log,
  );
  await refuses(
    "clipboard.writeText",
    () => vscode.env.clipboard.writeText("wb-probe-was-here"),
    log,
  );

  // 6. Write a laptop setting.
  await refuses(
    "update a global setting",
    () =>
      vscode.workspace
        .getConfiguration()
        .update("editor.fontSize", 41, vscode.ConfigurationTarget.Global),
    log,
  );

  // 7. Download a URL onto the laptop (the spike's path: _workbench.downloadResource).
  await refuses(
    "download a URL",
    () =>
      vscode.commands.executeCommand(
        "_workbench.downloadResource",
        vscode.Uri.parse("https://example.com/wb-probe"),
      ),
    log,
  );

  // 8. Open a webview panel. createWebviewPanel is fire-and-forget: the window
  // guard refuses it (see the window log), but the extension gets no error.
  await observe(
    "open a webview panel",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "wbProbe",
        "wb probe",
        vscode.ViewColumn.One,
        {},
      );

      panel.dispose();

      return "SENT (fire-and-forget; the window guard refuses it)";
    },
    log,
  );

  // 9. Apply a workspace edit on a laptop file. The guard makes applyEdit
  // return false (no edit applied); true would be a breach.
  await refuses(
    "applyEdit on the laptop",
    async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(localHosts, new vscode.Position(0, 0), "wb-probe\n");
      const applied = await vscode.workspace.applyEdit(edit);

      if (applied) return "applyEdit returned true";
      throw new Error("applyEdit returned false");
    },
    log,
  );

  // 10. Register a command id the window already has (vscode.openFolder is a
  // window command, absent from this host's own registry). registerCommand is
  // fire-and-forget: it registers in this host's registry, and the window guard
  // refuses replacing its command (see the window log). No error reaches the
  // extension, so this is recorded, not asserted.
  await observe(
    "registerCommand vscode.openFolder (a window command)",
    () => {
      const registration = vscode.commands.registerCommand(
        "vscode.openFolder",
        () => {},
      );

      registration.dispose();

      return "SENT (fire-and-forget; the window guard refuses the replacement)";
    },
    log,
  );

  // 11-14. Window UI the remote writes into, which the laptop user may click.
  // Each is fire-and-forget; the live check inspects the window: the status
  // bar item's command must be the host's relay (which refuses the laptop
  // command), and the texts must have lost their command: links.
  const openFolder = "command:vscode.openFolder?%5B%22file%3A%2F%2F%2F%22%5D";

  await observe(
    "status bar item with a laptop command",
    () => {
      const item = vscode.window.createStatusBarItem("wbProbe.item");

      item.text = "wb probe";
      // A web link and a file link: the extension host sends a `uris` map
      // for both, which the window must not keep.
      item.tooltip = new vscode.MarkdownString(
        `wb probe [open](${openFolder}) [web](https://ok.example) [hosts](file:///etc/hosts)`,
      );
      item.command = {
        command: "vscode.openFolder",
        title: "Open",
        arguments: [vscode.Uri.file("/")],
      };
      item.show();
      context.subscriptions.push(item);

      return "SENT (window check)";
    },
    log,
  );
  await observe(
    "notification with a command: link",
    () => {
      vscode.window.showWarningMessage(
        `wb probe notification [open](${openFolder})`,
      );
      // A `>` in the target and a quote in the title, which a hand-written
      // link regex misses but the window's own parser accepts.
      vscode.window.showWarningMessage(
        `wb probe gt [open](command:vscode.open?%5B%22file%3A%2F%2F%2Fetc%2Fhosts%22%5D#>x) [t](${openFolder} "t"x")`,
      );

      return "SENT (window check)";
    },
    log,
  );
  await observe(
    "window progress with a command link",
    () => {
      // The extension API gives window progress no `command` field; the guard
      // drops one sent over RPC (unit-tested). This checks its title's links.
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `wb probe progress [open](${openFolder})`,
        },
        () => new Promise((resolve) => setTimeout(resolve, 60_000)),
      );

      return "SENT (window check)";
    },
    log,
  );
  await observe(
    "diagnostic with a command: code target",
    () => {
      const diagnostics =
        vscode.languages.createDiagnosticCollection("wbProbe");

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        "wb probe diagnostic",
      );

      diagnostic.code = {
        value: "WBPROBE",
        target: vscode.Uri.parse(openFolder),
      };
      diagnostics.set(vscode.Uri.file("/tmp/wb-test-proj/a.ts"), [diagnostic]);
      context.subscriptions.push(diagnostics);

      return "SENT (window check)";
    },
    log,
  );
  await observe(
    "quick input with a command link",
    () => {
      const box = vscode.window.createInputBox();

      box.title = "wb probe";
      box.prompt = `wb probe prompt [open](${openFolder})`;
      box.validationMessage = `wb probe validation [open](${openFolder})`;
      box.show();
      context.subscriptions.push(box);

      return "SENT (window check)";
    },
    log,
  );

  // 16-19. An editor on this remote's own file, opened by the check (the
  // probe opens none): a decoration whose hover holds a trusted command: link
  // and whose icons and CSS point elsewhere, then the edits and options a
  // read-only review refuses. The live check inspects the window's editor.
  const editor = await ownEditor();

  if (editor) {
    await observe(
      "decoration with a trusted command: hover, a laptop icon and CSS",
      () => {
        const hover = new vscode.MarkdownString(
          `wb probe hover [open](${openFolder})`,
        );

        hover.isTrusted = true;

        const type = vscode.window.createTextEditorDecorationType({
          gutterIconPath: windowUri("vscode-local", "/etc/hosts"),
          backgroundColor:
            "red; background-image: url(https://example.com/wb-probe.png)",
          after: {
            contentText: " wb probe after",
            contentIconPath: vscode.Uri.parse(
              "https://example.com/wb-probe.png",
            ),
          },
        });

        editor.setDecorations(type, [
          { range: new vscode.Range(0, 0, 0, 1), hoverMessage: hover },
        ]);
        context.subscriptions.push(type);

        return "SENT (window check)";
      },
      log,
    );
    await refuses(
      "edit this remote's editor",
      async () =>
        `edit returned ${await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "wb-probe"))}`,
      log,
    );
    await refuses(
      "insertSnippet in this remote's editor",
      async () =>
        `returned ${await editor.insertSnippet(new vscode.SnippetString("wb-probe"))}`,
      log,
    );
    await observe(
      "set this remote's editor options",
      () => {
        editor.options = { tabSize: 7 };

        return "SENT (window check)";
      },
      log,
    );
  } else {
    log(
      "decorations and edits in this remote's editor: SKIPPED (no editor on this remote's files)",
    );
  }

  await observe(
    "language status item with a command",
    () => {
      const item = vscode.languages.createLanguageStatusItem(
        "wbProbe.status",
        "*",
      );

      item.text = "wb probe status";
      item.command = {
        command: "vscode.openFolder",
        title: "Open",
        arguments: [vscode.Uri.file("/")],
      };
      context.subscriptions.push(item);

      return "SENT (the window guard log)";
    },
    log,
  );

  // One allowed action: showing an information message needs the user, so it
  // is allowed. It resolves without a chosen item in a background window.
  try {
    vscode.window.showInformationMessage("wb probe: guard check ran");
    log("showInformationMessage: ALLOWED");
  } catch (error) {
    log(`showInformationMessage: UNEXPECTEDLY REFUSED: ${message(error)}`);
  }

  log("done");

  return logFile;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("wbProbe.run", () => run(context)),
  );
  // Report the failure to the log if the run itself throws.
  run(context).catch((error) => {
    try {
      const dir =
        process.env.WB_PROBE_LOG_DIR || context.globalStorageUri.fsPath;

      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        path.join(dir, "probe.log"),
        `probe crashed: ${String((error && error.stack) || error)}\n`,
      );
    } catch {
      // nothing more we can do
    }
  });
}

module.exports = { activate, deactivate() {} };
