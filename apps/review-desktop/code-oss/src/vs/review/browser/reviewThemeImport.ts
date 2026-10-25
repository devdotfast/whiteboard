/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../base/common/async.js';
import { VSBuffer } from '../../base/common/buffer.js';
import { Color } from '../../base/common/color.js';
import { Event } from '../../base/common/event.js';
import { Schemas } from '../../base/common/network.js';
import { parse, type ParseError } from '../../base/common/json.js';
import { basename, extname, joinPath } from '../../base/common/resources.js';
import type { URI } from '../../base/common/uri.js';
import { localize } from '../../nls.js';
import { IFileDialogService } from '../../platform/dialogs/common/dialogs.js';
import { ExtensionIdentifier, type IExtensionManifest } from '../../platform/extensions/common/extensions.js';
import { IFileService } from '../../platform/files/common/files.js';
import type { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IWorkbenchExtensionManagementService } from '../../workbench/services/extensionManagement/common/extensionManagement.js';
import { IExtensionService } from '../../workbench/services/extensions/common/extensions.js';
import { IWorkbenchThemeService, type IWorkbenchColorTheme } from '../../workbench/services/themes/common/workbenchThemeService.js';

const REGISTER_TIMEOUT_MS = 10_000;

/** Installs the themes in a picked .vsix or theme .json; undefined when cancelled. */
export async function importColorThemes(accessor: ServicesAccessor): Promise<IWorkbenchColorTheme[] | undefined> {
	const fileDialogService = accessor.get(IFileDialogService);
	const fileService = accessor.get(IFileService);
	const environmentService = accessor.get(IWorkbenchEnvironmentService);
	const extensionManagementService = accessor.get(IWorkbenchExtensionManagementService);
	const extensionService = accessor.get(IExtensionService);
	const themeService = accessor.get(IWorkbenchThemeService);

	const [picked] = await fileDialogService.showOpenDialog({
		title: localize('review.importTheme.title', "Import Color Theme"),
		openLabel: localize('review.importTheme.open', "Import"),
		canSelectFiles: true,
		filters: [{ name: localize('review.importTheme.filter', "VS Code theme"), extensions: ['vsix', 'json'] }],
	}) ?? [];
	if (!picked) {
		return undefined;
	}

	let manifest: IExtensionManifest;
	let install: () => Promise<unknown>;
	if (extname(picked).toLowerCase() === '.vsix') {
		manifest = await extensionManagementService.getManifest(picked);
		install = () => extensionManagementService.install(picked);
	} else {
		// installFromLocation needs a file: URI.
		const folder = await wrapThemeFile(fileService, environmentService.userRoamingDataHome.with({ scheme: Schemas.file }), picked);
		manifest = JSON.parse((await fileService.readFile(joinPath(folder, 'package.json'))).value.toString());
		install = () => extensionManagementService.installFromLocation(folder);
	}
	if (!manifest.contributes?.themes?.length) {
		throw new Error(localize('review.importTheme.noThemes', "{0} has no color themes.", basename(picked)));
	}

	const id = `${manifest.publisher}.${manifest.name}`;
	const registered = Event.toPromise(Event.filter(extensionService.onDidChangeExtensions, e => e.added.some(added => ExtensionIdentifier.equals(added.identifier, id))));
	await install();
	if (!(await extensionService.getExtension(id))) {
		await raceTimeout(registered, REGISTER_TIMEOUT_MS);
	}

	const themes = (await themeService.getColorThemes()).filter(theme => theme.extensionData && ExtensionIdentifier.equals(theme.extensionData.extensionId, id));
	if (!themes.length) {
		throw new Error(localize('review.importTheme.notLoaded', "{0} was installed, but its themes did not load.", basename(picked)));
	}
	return themes;
}

async function wrapThemeFile(fileService: IFileService, userDataHome: URI, file: URI): Promise<URI> {
	const text = (await fileService.readFile(file)).value.toString();
	const errors: ParseError[] = [];
	const theme = parse(text, errors);
	if (errors.length || typeof theme !== 'object' || !theme || (!theme.colors && !theme.tokenColors)) {
		throw new Error(localize('review.importTheme.invalid', "{0} is not a VS Code color theme.", basename(file)));
	}

	const label: string = typeof theme.name === 'string' && theme.name ? theme.name : basename(file).replace(/(-color-theme)?\.json$/i, '');
	const name = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
	const folder = joinPath(userDataHome, 'imported-themes', name);
	const manifest = {
		name,
		displayName: label,
		publisher: 'imported',
		version: '1.0.0',
		engines: { vscode: '*' },
		contributes: { themes: [{ id: label, label, uiTheme: uiTheme(theme), path: './theme.json' }] },
	};
	await fileService.writeFile(joinPath(folder, 'theme.json'), VSBuffer.fromString(text));
	await fileService.writeFile(joinPath(folder, 'package.json'), VSBuffer.fromString(JSON.stringify(manifest, null, '\t')));
	return folder;
}

function uiTheme(theme: { type?: unknown; colors?: Record<string, unknown> }): string {
	switch (theme.type) {
		case 'light': return 'vs';
		case 'dark': return 'vs-dark';
		case 'hc': case 'hcDark': return 'hc-black';
		case 'hcLight': return 'hc-light';
	}
	const background = theme.colors?.['editor.background'];
	return typeof background === 'string' && Color.Format.CSS.parseHex(background)?.isLighter() ? 'vs' : 'vs-dark';
}
