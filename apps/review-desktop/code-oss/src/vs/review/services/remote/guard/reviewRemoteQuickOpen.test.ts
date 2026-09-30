import assert from "node:assert/strict";
import test from "node:test";
import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Event } from "../../../../base/common/event.js";
import type { ILanguageService } from "../../../../editor/common/languages/language.js";
import type { IModelService } from "../../../../editor/common/services/model.js";
import type { ILabelService } from "../../../../platform/label/common/label.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IInputOptions, IQuickInputService } from "../../../../platform/quickinput/common/quickInput.js";
import type { ICustomEditorLabelService } from "../../../../workbench/services/editor/common/customEditorLabelService.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { ReviewRemoteQuickOpen } from "./reviewRemoteQuickOpen.js";

const A = "whiteboard+aaaa-1111";
const LINK = "see [this](command:vscode.openFolder?%5B%22file%3A%2F%2F%2F%22%5D) or [docs](https://example.com)";
const CLEAN = "see this or [docs](https://example.com)";

function setup() {
	const warnings: string[] = [];
	const input: Record<string, unknown> = {
		onDidAccept: Event.None, onDidTriggerButton: Event.None, onDidChangeValue: Event.None, onDidHide: Event.None,
		onDidChangeActive: Event.None, onDidChangeSelection: Event.None, onDidTriggerItemButton: Event.None,
		show() { }, hide() { }, dispose() { },
	};
	const asked: IInputOptions[] = [];
	const quickInput = {
		createQuickPick: () => input,
		createInputBox: () => input,
		input: async (options: IInputOptions) => {
			asked.push(options);
			return "typed";
		},
	} as unknown as IQuickInputService;
	const context = { getProxy: () => ({ $validateInput: async () => ({ content: LINK, severity: 3 }) }) } as unknown as IExtHostContext;
	const quickOpen = new ReviewRemoteQuickOpen(
		context, quickInput, {} as ILabelService, {} as ICustomEditorLabelService, {} as IModelService, {} as ILanguageService,
		new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService),
	);
	return { quickOpen, input, asked, warnings };
}

test("a remote quick pick's prompt, validation message and item tooltips keep only web links; markdown is untrusted", async () => {
	const { quickOpen, input, warnings } = setup();
	await quickOpen.$createOrUpdate({
		id: 1, type: "quickPick", title: "Pick", prompt: LINK, validationMessage: LINK,
		items: [{ handle: 0, label: "a", detail: LINK, tooltip: { value: LINK, isTrusted: true } }, { type: "separator", label: "s" }],
	});
	assert.equal(input.prompt, CLEAN);
	assert.equal(input.validationMessage, CLEAN);
	const [item] = input.items as { detail: string; tooltip: unknown }[];
	assert.equal(item.detail, CLEAN);
	assert.deepEqual(item.tooltip, { value: CLEAN, isTrusted: false, supportHtml: false });
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused links other than http, https and mailto in text a remote shows`]);
	quickOpen.dispose();
});

test("an input box's prompt and the host's validation answer keep only web links", async () => {
	const { quickOpen, asked } = setup();
	assert.equal(await quickOpen.$input({ prompt: LINK, title: "T" }, true, CancellationToken.None), "typed");
	assert.equal(asked[0].prompt, CLEAN);
	assert.deepEqual(await asked[0].validateInput!("x"), { content: CLEAN, severity: 3 });
	quickOpen.dispose();
});
