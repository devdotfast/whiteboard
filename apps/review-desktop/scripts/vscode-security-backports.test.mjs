import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const codeOss = new URL("../code-oss/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, codeOss), "utf8");
}

test("keeps the security boundary backports", async () => {
  const processes = await source("src/vs/base/common/processes.ts");

  const commands = await source(
    "src/vs/workbench/api/common/extHostCommands.ts",
  );

  const webview = await source(
    "src/vs/workbench/contrib/webview/browser/webviewElement.ts",
  );

  const environment = await source(
    "src/vs/workbench/services/environment/browser/environmentService.ts",
  );

  const terminal = await source(
    "src/vs/workbench/contrib/terminal/browser/terminalInstance.ts",
  );

  const urlHandler = await source(
    "src/vs/workbench/services/extensions/browser/extensionUrlHandler.ts",
  );

  for (const name of [
    "DEBUG",
    "NODE_OPTIONS",
    "VSCODE_NODE_OPTIONS",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
  ]) {
    assert.match(processes, new RegExp(`'${name}'`));
  }

  assert.match(processes, /dangerousEnvVariables\.has\(key\.toUpperCase\(\)\)/);
  assert.match(commands, /\.slice\(obj\.buffer\.byteOffset,/);
  assert.match(webview, /new Uint8Array\(chunk\.buffer\)/);
  assert.match(
    environment,
    /this\.payload && \(!this\.isBuilt \|\| this\.enableSmokeTestDriver\)/,
  );
  assert.match(
    terminal,
    /workspaceEmptyCreateTerminalCwd[\s\S]*?this\._userHome\)\n\s*\}\);\n\s*return;/,
  );

  const confirmation = urlHandler.indexOf("dialogService.confirm");
  const override = urlHandler.indexOf("overrideHandler.handleURL");
  assert.ok(confirmation !== -1 && override > confirmation);
});

test("keeps the memory and crash backports", async () => {
  const ipc = await source("src/vs/base/parts/ipc/common/ipc.ts");
  const app = await source("src/vs/code/electron-main/app.ts");
  const events = await source("src/vs/base/common/event.ts");

  const editors = await source(
    "src/vs/workbench/api/browser/mainThreadDocumentsAndEditors.ts",
  );

  const codeActions = await source(
    "src/vs/editor/contrib/codeAction/browser/codeActionModel.ts",
  );

  const multiDiff = await source(
    "src/vs/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.ts",
  );

  const textMate = await source(
    "src/vs/workbench/services/textMate/browser/textMateTokenizationFeatureImpl.ts",
  );

  assert.match(ipc, /unbufferedEvents\?: readonly string\[\]/);
  assert.match(app, /unbufferedEvents: \['onDidBlurMainWindow'\]/);
  assert.match(events, /private _getLeakageMonitor\(\)/);
  assert.match(events, /this\._stacks!\.delete\(stackKey\)/);
  assert.match(editors, /new DisposableMap<string, MainThreadTextEditor>\(\)/);
  assert.match(editors, /this\._textEditors\.deleteAndDispose\(id\)/);
  assert.match(codeActions, /this\.codeActionsDisposable\.clear\(\)/);
  assert.match(multiDiff, /if \(this\._store\.isDisposed\) \{\n\s*return;/);
  assert.ok((app.match(/frame\.isDestroyed\(\)/g) ?? []).length >= 3);
  assert.match(textMate, /this\._vscodeOniguruma = null;\n\s*throw error;/);
});

test("keeps the September 2026 advisory backports", async () => {
  const configuration = await source(
    "src/vs/platform/configuration/common/configurationModels.ts",
  );

  const webviewResources = await source(
    "src/vs/workbench/contrib/webview/browser/resourceLoading.ts",
  );

  const mcp = await source("src/vs/platform/mcp/common/mcpManagementService.ts");
  const sanitize = await source("src/vs/base/browser/domSanitize.ts");
  const markdown = await source("src/vs/base/browser/markdownRenderer.ts");

  // CVE-2026-81376 / CVE-2026-70334: nested configuration objects are filtered
  // against the registry by dotted path, not treated as opaque leaves.
  assert.match(configuration, /private filterProperty\(/);
  assert.match(configuration, /this\.filterProperty\(`\$\{path\}\.\$\{key\}`/);

  // CVE-2026-81383: backslashes are normalized before the containment check so
  // a Windows-style separator cannot escape a non-file root.
  assert.match(webviewResources, /if \(root\.scheme !== Schemas\.file\) \{/);
  assert.match(
    webviewResources,
    /const normalizedPath = resource\.path\.replace\(/,
  );

  // CVE-2026-81377: resolved MCP paths stay inside the storage directory, and
  // uninstall refuses a server whose recorded location is not its derived one.
  assert.match(
    mcp,
    /!this\.uriIdentityService\.extUri\.isEqualOrParent\(location, this\.mcpLocation\)/,
  );
  assert.match(mcp, /override async uninstall\(/);

  // CVE-2026-81380: media sources are validated during sanitization rather than
  // after the src attribute is attached, so no request is ever issued.
  assert.match(sanitize, /mediaSourceIsAllowed\?: \(source: string\) => boolean/);
  assert.match(sanitize, /mediaSourceIsAllowed && !mediaSourceIsAllowed\(attrValue\)/);
  assert.match(markdown, /mediaSourceIsAllowed: remoteImageIsAllowed \?/);
  assert.doesNotMatch(markdown, /el\.replaceWith\(DOM\.\$\('', undefined, el\.outerHTML\)\)/);
});
