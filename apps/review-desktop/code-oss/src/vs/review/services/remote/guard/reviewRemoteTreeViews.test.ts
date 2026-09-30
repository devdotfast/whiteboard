import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionIdentifier, type IExtensionDescription } from "../../../../platform/extensions/common/extensions.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { MainThreadTreeViewsShape } from "../../../../workbench/api/common/extHost.protocol.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { ReviewRemoteTreeViews } from "./reviewRemoteTreeViews.js";

const A = "whiteboard+aaaa-1111";

test("a host's own view ids are accepted; a laptop extension's view is refused, logged once", async () => {
	const warnings: string[] = [];
	const probe = { identifier: new ExtensionIdentifier("wb-test.probe"), contributes: { views: { explorer: [{ id: "wbProbe.tree", name: "Probe" }] } } } as unknown as IExtensionDescription;
	const views: MainThreadTreeViewsShape = new ReviewRemoteTreeViews(
		{} as IExtHostContext,
		{ _serviceBrand: undefined, extensions: [probe] },
		new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService),
	);
	const options = { showCollapseAll: false, canSelectMany: false, dropMimeTypes: [], dragMimeTypes: [], hasHandleDrag: false, hasHandleDrop: false, manuallyManageCheckboxes: false };
	await views.$registerTreeViewDataProvider("wbProbe.tree", options);
	await assert.rejects(views.$registerTreeViewDataProvider("references-view.tree", options), /^Error: Not available for an extension on wb-test-a: using the window's views \(references-view.tree\)\.$/);
	assert.throws(() => views.$setMessage("references-view.tree", "[x](command:y)"), /using the window's views/);
	await assert.rejects(views.$reveal("references-view.tree", undefined, {}), /using the window's views/);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused using the window's views`]);
});
