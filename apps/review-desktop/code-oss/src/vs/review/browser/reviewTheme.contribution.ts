/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../base/common/color.js';
import { localize, localize2 } from '../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import type { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, type IQuickPickItem } from '../../platform/quickinput/common/quickInput.js';
import { registerColor } from '../../platform/theme/common/colorRegistry.js';
import { ACTIVITY_BAR_BADGE_BACKGROUND } from '../../workbench/common/theme.js';
import { focusBorder, textLinkForeground } from '../../platform/theme/common/colors/baseColors.js';
import { editorBackground } from '../../platform/theme/common/colors/editorColors.js';
import { buttonBackground } from '../../platform/theme/common/colors/inputColors.js';
import { listHighlightForeground } from '../../platform/theme/common/colors/listColors.js';
import { progressBarBackground } from '../../platform/theme/common/colors/miscColors.js';
import { isDark } from '../../platform/theme/common/theme.js';
import { type IColorTheme, IThemeService, registerThemingParticipant } from '../../platform/theme/common/themeService.js';
import { type ReviewThemeChoice, applyReviewThemeChoice, currentReviewThemeChoice } from './reviewThemeChoice.js';

interface IReviewThemeQuickPickItem extends IQuickPickItem {
	readonly choice: ReviewThemeChoice;
}

class SelectReviewThemeAction extends Action2 {
	constructor() {
		super({
			id: 'review.selectTheme',
			title: localize2('review.selectTheme', "Whiteboard: Theme"),
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const quickInputService = accessor.get(IQuickInputService);
		const themeService = accessor.get(IThemeService);
		const currentChoice = currentReviewThemeChoice(configurationService, themeService);
		const items: IReviewThemeQuickPickItem[] = [
			{ choice: 'light', label: localize('review.theme.light', "Light"), picked: currentChoice === 'light' },
			{ choice: 'dark', label: localize('review.theme.dark', "Dark"), picked: currentChoice === 'dark' },
			{ choice: 'system', label: localize('review.theme.system', "System"), picked: currentChoice === 'system' }
		];

		const picked = await quickInputService.pick(items, {
			title: localize('review.theme.title', "Whiteboard: Theme"),
			placeHolder: localize('review.theme.placeholder', "Select a theme")
		});
		if (!picked) {
			return;
		}

		await applyReviewThemeChoice(configurationService, picked.choice);
	}
}

registerAction2(SelectReviewThemeAction);

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	command: {
		id: 'review.selectTheme',
		title: localize('review.selectTheme.menu', "Theme...")
	},
	order: 0
});

const reviewAccent = registerColor('review.accent', null, localize('review.accent', "Whiteboard's accent color. When unset, Whiteboard picks one from the theme."));

const SYNTAX_TOKEN_TYPES = ['comment', 'keyword', 'type', 'function', 'string', 'number', 'operator'];

const ACCENT_CANDIDATES = [textLinkForeground, ACTIVITY_BAR_BADGE_BACKGROUND, progressBarBackground, buttonBackground, focusBorder, listHighlightForeground];

// Status colors are also text, so they need more contrast than the accent.
const STATUS_COLORS = [
	{ name: 'warning', candidates: ['editorWarning.foreground', 'terminal.ansiYellow'], dark: '#F2C14E', light: '#C98A0B' },
	{ name: 'danger', candidates: ['editorError.foreground', 'terminal.ansiRed'], dark: '#F26A55', light: '#D8402C' },
	{ name: 'success', candidates: ['terminal.ansiGreen', 'testing.iconPassed'], dark: '#4ED990', light: '#1B9A57' },
];

/** The first readable candidate the theme defines (registry defaults are VS Code's), else Whiteboard's. */
function themeColor(theme: IColorTheme, candidates: readonly string[], minContrast: number, dark: string, light: string): Color {
	const background = theme.getColor(editorBackground);
	const picked = candidates
		.filter(id => theme.defines(id))
		.map(id => theme.getColor(id))
		.find(color => color?.isOpaque() && (!background || color.getContrastRatio(background) >= minContrast));
	return picked ?? Color.fromHex(isDark(theme.type) ? dark : light);
}

registerThemingParticipant((theme, collector) => {
	const accent = theme.getColor(reviewAccent) ?? themeColor(theme, ACCENT_CANDIDATES, 2, '#5B7CFF', '#2B55E6');
	const onAccent = accent.getContrastRatio(Color.white) >= 3 ? Color.white : Color.black;
	const vars = [`--review-accent: ${accent};`, `--review-on-accent: ${onAccent};`];
	for (const { name, candidates, dark, light } of STATUS_COLORS) {
		vars.push(`--review-${name}: ${themeColor(theme, candidates, 2.5, dark, light)};`);
	}
	for (const type of SYNTAX_TOKEN_TYPES) {
		const foreground = theme.getTokenStyleMetadata(type, [], '')?.foreground;
		const color = foreground === undefined ? undefined : theme.tokenColorMap[foreground];
		if (color) {
			vars.push(`--review-syntax-${type}: ${color};`);
		}
	}
	collector.addRule(`.monaco-workbench { ${vars.join(' ')} }`);
});
