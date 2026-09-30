import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionIdentifier, type IExtensionDescription } from "../../../../platform/extensions/common/extensions.js";
import type { IExtensionService } from "../../../../workbench/services/extensions/common/extensions.js";
import { reviewRemoteExtensionService } from "./reviewRemoteExtensionService.js";

test("activation goes to the host, and lookups answer with the host's own extensions", async () => {
	const onLaptop: string[] = [];
	const onHost: string[] = [];
	const window = {
		activateByEvent: async (event: string) => { onLaptop.push(event); },
		getExtension: async () => ({ identifier: new ExtensionIdentifier("laptop.ext"), extensionLocation: "file:///Users/me/.vscode/ext" }),
	} as unknown as IExtensionService;
	const probe = { identifier: new ExtensionIdentifier("wb-test.remote-guard-probe") } as IExtensionDescription;
	const extensions = reviewRemoteExtensionService(window, [probe], async (event) => { onHost.push(event); });
	await extensions.activateByEvent("onSearch:vscode-remote");
	assert.deepEqual([onLaptop, onHost], [[], ["onSearch:vscode-remote"]]);
	assert.equal(await extensions.whenInstalledExtensionsRegistered(), true);
	assert.equal(await extensions.getExtension("WB-TEST.remote-guard-probe"), probe);
	assert.equal(await extensions.getExtension("laptop.ext"), undefined);
	assert.deepEqual(extensions.extensions, [probe]);
});
