import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { ILanguagePackService } from "../../../../platform/languagePacks/common/languagePacks.js";
import { reviewRemoteLanguagePackService } from "./reviewRemoteLanguagePackService.js";

test("a built-in extension's translations are not a laptop path, and the rest is the window's", async () => {
	const base = {
		getBuiltInExtensionTranslationsUri: async () => URI.file("/Applications/Whiteboard.app/Contents/Resources/nls/ts.json"),
		getInstalledLanguages: async () => [{ id: "en" }],
	} as unknown as ILanguagePackService;
	const packs = reviewRemoteLanguagePackService(base);
	assert.equal(await packs.getBuiltInExtensionTranslationsUri("vscode.typescript-language-features", "de"), undefined);
	assert.deepEqual(await packs.getInstalledLanguages(), [{ id: "en" }]);
});
