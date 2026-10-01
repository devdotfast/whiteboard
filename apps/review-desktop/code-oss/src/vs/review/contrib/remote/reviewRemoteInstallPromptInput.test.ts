/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { createRemoteInstallPromptInput } from "./reviewRemoteInstallPromptInput.js";

test("the install prompt shows its text as plain description and answers with the pick", () => {
	let accept = () => {};
	const pick = {
		selectedItems: [] as { answer: string }[],
		items: [] as { label: string; answer: string }[],
		onDidAccept: (handler: () => void) => {
			accept = handler;
			return { dispose() {} };
		},
	} as Record<string, unknown> & { selectedItems: { answer: string }[]; items: { label: string; answer: string }[] };
	const answers: (string | undefined)[] = [];
	const text = "Whiteboard 0.1.6 is not installed on box. [x](command:evil) $(zap)";

	createRemoteInstallPromptInput({ createQuickPick: () => pick } as never, { id: 1, alias: "box", text, kind: "confirm" }, "Install Whiteboard on box?", { install: "Install", decline: "Don't install" }, (answer) => answers.push(answer));

	assert.equal(pick.description, text);
	assert.equal(pick.prompt, undefined);
	assert.equal(pick.ignoreFocusOut, true);
	assert.deepEqual(pick.items.map((item) => item.label), ["Install", "Don't install"]);
	for (const item of pick.items) {
		pick.selectedItems = [item];
		accept();
	}
	assert.deepEqual(answers, ["install", "decline"]);
});
