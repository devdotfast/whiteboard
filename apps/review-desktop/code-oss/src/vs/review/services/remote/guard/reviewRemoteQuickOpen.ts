/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from "../../../../base/common/cancellation.js";
import { isMarkdownString, type IMarkdownString } from "../../../../base/common/htmlContent.js";
import { ILanguageService } from "../../../../editor/common/languages/language.js";
import { IModelService } from "../../../../editor/common/services/model.js";
import { ILabelService } from "../../../../platform/label/common/label.js";
import { type IInputOptions, type IPickOptions, IQuickInputService } from "../../../../platform/quickinput/common/quickInput.js";
import { MainThreadQuickOpen } from "../../../../workbench/api/browser/mainThreadQuickOpen.js";
import {
	ExtHostContext,
	type ExtHostQuickOpenShape,
	type IInputBoxOptions,
	type TransferQuickInput,
	type TransferQuickPickItem,
	type TransferQuickPickItemOrSeparator,
} from "../../../../workbench/api/common/extHost.protocol.js";
import { ICustomEditorLabelService } from "../../../../workbench/services/editor/common/customEditorLabelService.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** The quick input texts the window renders with links it opens with commands allowed. */
const TEXTS = ["title", "prompt", "placeholder", "validationMessage", "description", "detail"] as const;

/**
 * Quick input stays allowed, but its prompt, validation message and item and
 * button tooltips are rendered with links the window opens with commands
 * allowed. For a remote host they keep only web and mail links, and markdown
 * is untrusted. Upstream's input box asks the host to validate through a
 * private proxy, so `$input` is rebuilt here to clean the answer too.
 */
export class ReviewRemoteQuickOpen extends MainThreadQuickOpen {
	private readonly remote: ExtHostQuickOpenShape;

	constructor(
		extHostContext: IExtHostContext,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@ILabelService labelService: ILabelService,
		@ICustomEditorLabelService customEditorLabelService: ICustomEditorLabelService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals,
	) {
		super(extHostContext, quickInput, labelService, customEditorLabelService, modelService, languageService);
		this.remote = extHostContext.getProxy(ExtHostContext.ExtHostQuickOpen);
	}

	private clean<T extends object>(value: T): T {
		const result = { ...value } as Record<string, unknown>;
		for (const key of TEXTS) if (typeof result[key] === "string") result[key] = this.refusals.text(result[key]);
		const tooltip = result.tooltip as string | IMarkdownString | undefined;
		if (tooltip !== undefined) result.tooltip = isMarkdownString(tooltip) ? this.refusals.markdown(tooltip) : this.refusals.text(tooltip);
		if (Array.isArray(result.buttons)) result.buttons = result.buttons.map((button: object) => this.clean(button));
		return result as T;
	}

	private items(items: TransferQuickPickItemOrSeparator[]) {
		return items.map((item) => (item.type === "separator" ? item : this.clean<TransferQuickPickItem>(item)));
	}

	override $show(instance: number, options: IPickOptions<TransferQuickPickItem>, token: CancellationToken) {
		return super.$show(instance, this.clean(options), token);
	}

	override $setItems(instance: number, items: TransferQuickPickItemOrSeparator[]) {
		return super.$setItems(instance, this.items(items));
	}

	override $createOrUpdate(params: TransferQuickInput) {
		const cleaned = this.clean(params);
		if (params.items) cleaned.items = this.items(params.items);
		return super.$createOrUpdate(cleaned);
	}

	override $input(options: IInputBoxOptions | undefined, validateInput: boolean, token: CancellationToken): Promise<string | undefined> {
		const inputOptions: IInputOptions = Object.create(null);
		if (options) {
			const cleaned = this.clean(options);
			inputOptions.title = cleaned.title;
			inputOptions.password = cleaned.password;
			inputOptions.placeHolder = cleaned.placeHolder && this.refusals.text(cleaned.placeHolder);
			inputOptions.valueSelection = cleaned.valueSelection;
			inputOptions.prompt = cleaned.prompt;
			inputOptions.value = cleaned.value;
			inputOptions.ignoreFocusLost = cleaned.ignoreFocusOut;
		}
		if (validateInput) {
			inputOptions.validateInput = async (value) => {
				const result = await this.remote.$validateInput(value);
				if (typeof result === "string") return this.refusals.text(result);
				return result ? { ...result, content: this.refusals.text(result.content) } : result;
			};
		}
		return this.quickInput.input(inputOptions, token);
	}
}
