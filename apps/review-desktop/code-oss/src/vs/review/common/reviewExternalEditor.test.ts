/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { externalEditorUrl } from "./reviewExternalEditor.js";

test("an editor URL carries the encoded path and the selected position", () => {
	assert.equal(
		externalEditorUrl({ editor: "cursor", filePath: "/repo/my src/#1.ts", line: 42, column: 3 }),
		"cursor://file/repo/my%20src/%231.ts:42:3",
	);
	assert.equal(externalEditorUrl({ editor: "zed", filePath: "/repo/a.ts", line: 7 }), "zed://file/repo/a.ts:7:1");
	assert.equal(externalEditorUrl({ editor: "vscode", filePath: "/repo/a.ts" }), "vscode://file/repo/a.ts");
});

test("only an absolute file in a known editor gets a URL", () => {
	assert.equal(externalEditorUrl({ editor: "whiteboard", filePath: "/repo/a.ts" }), undefined);
	assert.equal(externalEditorUrl({ editor: "toString", filePath: "/repo/a.ts" }), undefined);
	assert.equal(externalEditorUrl({ editor: "vscode", filePath: "repo/a.ts" }), undefined);
	assert.equal(externalEditorUrl({ editor: "vscode", filePath: 42 as never }), undefined);
});
