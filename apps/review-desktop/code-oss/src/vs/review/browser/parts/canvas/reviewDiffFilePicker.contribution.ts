/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareItemsByFuzzyScore, type FuzzyScorerCache, prepareQuery, scoreItemFuzzy } from "../../../../base/common/fuzzyScorer.js";
import { KeyCode, KeyMod } from "../../../../base/common/keyCodes.js";
import { DisposableStore } from "../../../../base/common/lifecycle.js";
import { posix } from "../../../../base/common/path.js";
import { URI } from "../../../../base/common/uri.js";
import { getIconClasses } from "../../../../editor/common/services/getIconClasses.js";
import { ILanguageService } from "../../../../editor/common/languages/language.js";
import { IModelService } from "../../../../editor/common/services/model.js";
import { localize, localize2 } from "../../../../nls.js";
import { Action2, registerAction2 } from "../../../../platform/actions/common/actions.js";
import { ContextKeyExpr } from "../../../../platform/contextkey/common/contextkey.js";
import { FileKind } from "../../../../platform/files/common/files.js";
import type { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingsRegistry.js";
import { IQuickInputService, type IQuickPickItem, quickPickItemScorerAccessor } from "../../../../platform/quickinput/common/quickInput.js";
import { inQuickPickContext } from "../../../../workbench/browser/quickaccess.js";
import { ActiveEditorContext } from "../../../../workbench/common/contextkeys.js";
import { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import { orderReviewDiffFiles } from "../../../common/reviewChangedFilesModel.js";
import { ReviewCanvasEditorInput } from "./reviewCanvasEditorInput.js";
import { ReviewCanvasEditorPane } from "./reviewCanvasPart.js";

interface DiffFileItem extends IQuickPickItem {
	path: string;
}

class ReviewGoToDiffFileAction extends Action2 {
	constructor() {
		super({
			id: "review.action.goToDiffFile",
			title: localize2("review.action.goToDiffFile", "Go to File in Diff"),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 1,
				primary: KeyMod.CtrlCmd | KeyCode.KeyP,
				when: ContextKeyExpr.and(ActiveEditorContext.isEqualTo(ReviewCanvasEditorInput.EDITOR_ID), inQuickPickContext.negate()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const modelService = accessor.get(IModelService);
		const languageService = accessor.get(ILanguageService);
		const active = accessor.get(IEditorService).activeEditorPane;
		const pane = active instanceof ReviewCanvasEditorPane ? active : undefined;
		const files = pane?.diffFiles();
		if (!pane || !files) {
			quickInput.quickAccess.show();
			return;
		}

		const disposables = new DisposableStore();
		const picker = disposables.add(quickInput.createQuickPick<DiffFileItem>());
		picker.placeholder = localize("review.goToDiffFile.placeholder", "Search files in the diff");
		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false;
		picker.busy = true;
		let items: DiffFileItem[] = [];
		const filter = () => {
			const query = prepareQuery(picker.value);
			if (!query.normalized) {
				picker.items = items;
				return;
			}
			const cache: FuzzyScorerCache = Object.create(null);
			picker.items = items
				.map(item => ({ item, score: scoreItemFuzzy(item, query, true, quickPickItemScorerAccessor, cache) }))
				.filter(({ score }) => score.score > 0)
				.sort((a, b) => compareItemsByFuzzyScore(a.item, b.item, query, true, quickPickItemScorerAccessor, cache))
				.map(({ item, score }) => ({ ...item, highlights: { label: score.labelMatch, description: score.descriptionMatch } }));
		};
		disposables.add(picker.onDidChangeValue(filter));
		disposables.add(picker.onDidAccept(() => {
			const [item] = picker.selectedItems;
			picker.hide();
			if (item) pane.revealDiffFile(item.path);
		}));
		disposables.add(picker.onDidHide(() => disposables.dispose()));
		picker.show();

		try {
			const ordered = orderReviewDiffFiles(await files);
			if (disposables.isDisposed) return;
			items = ordered.map(file => {
				const folder = posix.dirname(file.path);
				return {
					path: file.path,
					label: posix.basename(file.path),
					description: folder === "." ? undefined : folder,
					iconClasses: getIconClasses(modelService, languageService, URI.file(file.path), FileKind.FILE),
				};
			});
			filter();
		} catch (error) {
			if (disposables.isDisposed) return;
			picker.validationMessage = error instanceof Error ? error.message : String(error);
		}
		picker.busy = false;
	}
}

registerAction2(ReviewGoToDiffFileAction);
