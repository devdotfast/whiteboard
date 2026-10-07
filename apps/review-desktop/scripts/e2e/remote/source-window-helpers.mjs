/** Helpers the Source-window journeys run against a Source window over CDP. */

import assert from "node:assert/strict";

/**
 * Runs `fn` in the Source window with its services, reached through its
 * extension service instance: the journey needs no hook in the product.
 */
export async function inSource(page, fn, ...args) {
  const cdp = await page.context().newCDPSession(page);

  try {
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

    const prototype = await cdp.send("Runtime.evaluate", {
      expression:
        'import(globalThis._VSCODE_FILE_ROOT + "vs/workbench/services/extensions/electron-browser/nativeExtensionService.js").then((m) => m.NativeExtensionService.prototype)',
      awaitPromise: true,
    });

    const { objects } = await cdp.send("Runtime.queryObjects", {
      prototypeObjectId: prototype.result.objectId,
    });

    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: objects.objectId,
      functionDeclaration: `async function (args) {
        // Subclass prototypes have the prototype in their chain too.
        const service = [...this].reverse().find((s) => Object.hasOwn(s, "_instantiationService"));
        const imp = (file) => import(globalThis._VSCODE_FILE_ROOT + file);
        const get = async (file, id) => {
          const module = await imp(file);
          return service._instantiationService.invokeFunction((a) => a.get(module[id]));
        };
        const value = await (${fn.toString()})({ service, get, imp }, ...args);
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      }`,
      arguments: [{ value: args }],
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );

    return result.result.value;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Types into f.ts; returns the read-only notice, after checking the text did not change. */
export async function typeInto(source, ctx) {
  const before = await inSource(source, fileText);

  await source.locator(".monaco-editor .view-lines").first().click();
  await source.keyboard.type("x");

  const message = await ctx.until(
    () =>
      source.evaluate(() =>
        [...document.querySelectorAll(".monaco-editor-overlaymessage")]
          .map((e) => e.innerText.trim())
          .find(Boolean),
      ),
    "the read-only notice",
    10000,
  );

  assert.equal(await inSource(source, fileText), before, "typing changed f.ts");

  return { message };
}

export async function quickRows(page) {
  return page
    .locator(".quick-input-list .monaco-list-row")
    .allInnerTexts()
    .catch(() => []);
}

// The functions below run in the Source window.

export async function windowState({ get }) {
  const [editors, workspace, environment] = await Promise.all([
    get(
      "vs/workbench/services/editor/common/editorService.js",
      "IEditorService",
    ),
    get("vs/platform/workspace/common/workspace.js", "IWorkspaceContextService"),
    get(
      "vs/workbench/services/environment/common/environmentService.js",
      "IWorkbenchEnvironmentService",
    ),
  ]);

  return {
    authority: environment.remoteAuthority,
    title: document.title,
    folder: workspace.getWorkspace().folders[0]?.uri.toString(),
    active: {
      resource: editors.activeEditor?.resource?.toString(),
      readonly: !!editors.activeEditor?.isReadonly(),
    },
  };
}

export async function fileText({ get }) {
  const models = await get(
    "vs/editor/common/services/model.js",
    "IModelService",
  );

  return models
    .getModels()
    .find((m) => m.uri.scheme === "vscode-remote" && m.uri.path.endsWith("/f.ts"))
    ?.getValue();
}

export async function focusFile({ get, imp }, resource) {
  const editors = await get(
    "vs/workbench/services/editor/common/editorService.js",
    "IEditorService",
  );

  const { URI } = await imp("vs/base/common/uri.js");

  await editors.openEditor({
    resource: URI.parse(resource),
    options: { pinned: true },
  });

  return true;
}

export async function pointAt({ get }, line, word) {
  const editor = (
    await get("vs/editor/browser/services/codeEditorService.js", "ICodeEditorService")
  ).getActiveCodeEditor();

  const position = {
    lineNumber: line,
    column: editor.getModel().getLineContent(line).indexOf(word) + 2,
  };

  editor.revealLineInCenter(line);

  let at = editor.getScrolledVisiblePosition(position);

  for (let frame = 0; !at && frame < 120; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    at = editor.getScrolledVisiblePosition(position);
  }

  if (!at) throw new Error(`line ${line} never rendered`);

  const rect = editor.getDomNode().getBoundingClientRect();

  return {
    x: Math.round(rect.left + at.left),
    y: Math.round(rect.top + at.top + at.height / 2),
  };
}
