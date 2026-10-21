/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../base/common/color.js';
import { localize } from '../../nls.js';
import { MenuId, MenuRegistry } from '../../platform/actions/common/actions.js';
import { ConfigurationTarget, IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { registerColor } from '../../platform/theme/common/colorRegistry.js';
import { ACTIVITY_BAR_BADGE_BACKGROUND } from '../../workbench/common/theme.js';
import { focusBorder, textLinkForeground } from '../../platform/theme/common/colors/baseColors.js';
import { editorBackground } from '../../platform/theme/common/colors/editorColors.js';
import { buttonBackground } from '../../platform/theme/common/colors/inputColors.js';
import { listHighlightForeground } from '../../platform/theme/common/colors/listColors.js';
import { progressBarBackground } from '../../platform/theme/common/colors/miscColors.js';
import { isDark } from '../../platform/theme/common/theme.js';
import { type IColorTheme, registerThemingParticipant } from '../../platform/theme/common/themeService.js';
import { type IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { IHostColorSchemeService } from '../../workbench/services/themes/common/hostColorSchemeService.js';

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	command: {
		id: 'workbench.action.selectTheme',
		title: localize('review.selectTheme.menu', "Theme...")
	},
	order: 0
});

const THEME_MIGRATED_KEY = 'review.theme.pinnedFromAutoDetect';

/** Pins the theme auto-detect shows, once, so Whiteboard has one theme setting. */
class ReviewThemeMigration implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.reviewThemeMigration';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IHostColorSchemeService hostColorSchemeService: IHostColorSchemeService,
		@IStorageService storageService: IStorageService,
		@ILogService logService: ILogService,
	) {
		if (storageService.getBoolean(THEME_MIGRATED_KEY, StorageScope.APPLICATION)) {
			return;
		}
		pinAutoDetectedTheme(configurationService, hostColorSchemeService).then(
			() => storageService.store(THEME_MIGRATED_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE),
			error => logService.warn('Could not pin the color theme; will retry next launch', error),
		);
	}
}

async function pinAutoDetectedTheme(configurationService: IConfigurationService, hostColorSchemeService: IHostColorSchemeService): Promise<void> {
	const autoDetect = configurationService.inspect<boolean>('window.autoDetectColorScheme');
	if (!autoDetect.value || autoDetect.userValue !== undefined) {
		return;
	}
	// The theme service may still hold a placeholder; resolve the theme as it does.
	const theme = configurationService.getValue<string>(hostColorSchemeService.dark ? 'workbench.preferredDarkColorTheme' : 'workbench.preferredLightColorTheme');
	await configurationService.updateValue('workbench.colorTheme', theme, ConfigurationTarget.USER);
	await configurationService.updateValue('window.autoDetectColorScheme', false, ConfigurationTarget.USER);
}

registerWorkbenchContribution2(ReviewThemeMigration.ID, ReviewThemeMigration, WorkbenchPhase.AfterRestored);

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
