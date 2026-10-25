/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from '../../base/browser/domStylesheets.js';
import { Disposable, toDisposable } from '../../base/common/lifecycle.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { EDITOR_FONT_FAMILY_SETTING, EDITOR_FONT_LIGATURES_SETTING, EDITOR_FONT_SIZE_SETTING, REVIEW_DOCUMENT_FONT_SIZE_BASE, REVIEW_DOCUMENT_FONT_SIZE_SETTING, REVIEW_READING_FONT_SETTING } from '../common/reviewConfigurationDefaults.js';

const SETTINGS = [REVIEW_DOCUMENT_FONT_SIZE_SETTING, REVIEW_READING_FONT_SETTING, EDITOR_FONT_SIZE_SETTING, EDITOR_FONT_FAMILY_SETTING, EDITOR_FONT_LIGATURES_SETTING];

class ReviewAppearance extends Disposable {
	constructor(@IConfigurationService private readonly configuration: IConfigurationService) {
		super();
		const sheet = createStyleSheet();
		this._register(toDisposable(() => sheet.remove()));
		const update = () => sheet.textContent = `.monaco-workbench.review-workbench { ${this.vars().join(' ')} }`;
		this._register(configuration.onDidChangeConfiguration(event => {
			if (SETTINGS.some(key => event.affectsConfiguration(key))) {
				update();
			}
		}));
		update();
	}

	private vars(): string[] {
		const number = (key: string) => Number(this.configuration.getValue(key)) || undefined;
		const documentSize = number(REVIEW_DOCUMENT_FONT_SIZE_SETTING) ?? REVIEW_DOCUMENT_FONT_SIZE_BASE;
		const codeSize = number(EDITOR_FONT_SIZE_SETTING);
		const family = String(this.configuration.getValue(EDITOR_FONT_FAMILY_SETTING) ?? '').trim();
		const vars = [
			`--review-document-scale: ${documentSize / REVIEW_DOCUMENT_FONT_SIZE_BASE};`,
			`--review-code-ligatures: ${this.configuration.getValue(EDITOR_FONT_LIGATURES_SETTING) === false ? 'none' : 'normal'};`,
		];
		if (codeSize) {
			vars.push(`--review-code-font-size: ${codeSize}px;`);
		}
		// An invalid list would void the code font, and could escape this rule.
		if (family && CSS.supports('font-family', family)) {
			vars.push(`--review-code-font: ${family};`);
		}
		if (this.configuration.getValue(REVIEW_READING_FONT_SETTING) === 'sans') {
			vars.push('--review-reading-font: var(--review-chrome-font);');
		}
		return vars;
	}
}

registerWorkbenchContribution2('review.appearance', ReviewAppearance, WorkbenchPhase.BlockStartup);
