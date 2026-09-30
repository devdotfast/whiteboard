/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { deepClone } from "../../../../base/common/objects.js";
import type { IConfigurationChange, IConfigurationChangeEvent, IConfigurationData, IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { ConfigurationModel } from "../../../../platform/configuration/common/configurationModels.js";
import { Extensions, type IConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.js";
import type { IExtensionDescription } from "../../../../platform/extensions/common/extensions.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { Registry } from "../../../../platform/registry/common/platform.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Keys this host's extensions contribute, with their defaults. A key the
 * window already has from its product or from another extension is left out,
 * so a remote cannot claim `http.proxy` or another extension's settings.
 */
export function remoteContributedSettings(extensions: readonly IExtensionDescription[]): Map<string, unknown> {
	const registered = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties();
	const settings = new Map<string, unknown>();
	for (const extension of extensions) {
		const nodes: unknown = extension.contributes?.configuration;
		for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
			const properties: unknown = (node as { properties?: unknown } | undefined)?.properties;
			if (!properties || typeof properties !== "object") continue;
			for (const [key, schema] of Object.entries(properties)) {
				const owner = registered[key]?.source;
				if (registered[key] && (typeof owner !== "object" || owner.id.toLowerCase() !== extension.identifier.value.toLowerCase())) continue;
				settings.set(key, (schema as { default?: unknown } | undefined)?.default);
			}
		}
	}
	return settings;
}

/**
 * What a host's extensions read is the defaults, plus the user's own values
 * for the keys they contribute: never the rest of the user's settings, the
 * workspace's or a policy. Writes are refused. Main-thread code of the host
 * still reads the window's values, and those stay on the laptop.
 */
export function reviewRemoteConfigurationService(
	base: IConfigurationService,
	extensions: readonly IExtensionDescription[],
	refusals: ReviewRemoteRefusals,
	logService: ILogService,
): IConfigurationService {
	const settings = remoteContributedSettings(extensions);
	const data = (): IConfigurationData => {
		const window = base.getConfigurationData();
		const defaults = window
			? new ConfigurationModel(deepClone(window.defaults.contents), [...window.defaults.keys], deepClone(window.defaults.overrides), undefined, logService)
			: ConfigurationModel.createEmptyModel(logService);
		const user = ConfigurationModel.createEmptyModel(logService);
		for (const [key, value] of settings) {
			if (value !== undefined && !defaults.keys.includes(key)) defaults.setValue(key, value);
			const mine = base.inspect(key).userLocalValue;
			if (mine !== undefined) user.setValue(key, deepClone(mine));
		}
		const empty = ConfigurationModel.createEmptyModel(logService).toJSON();
		return { defaults: defaults.toJSON(), policy: empty, application: empty, userLocal: user.toJSON(), userRemote: empty, workspace: empty, folders: [] };
	};
	const filter = (change: IConfigurationChange): IConfigurationChange => ({
		keys: change.keys.filter((key) => settings.has(key)),
		overrides: change.overrides.map(([id, keys]): [string, string[]] => [id, keys.filter((key) => settings.has(key))]).filter(([, keys]) => keys.length > 0),
	});
	const writes = "changing settings";
	return override(base, {
		getConfigurationData: data,
		onDidChangeConfiguration: Event.filter(
			Event.map(base.onDidChangeConfiguration, (e): IConfigurationChangeEvent => {
				const change = filter(e.change);
				return { source: e.source, change, affectedKeys: new Set(change.keys), affectsConfiguration: (key, overrides) => e.affectsConfiguration(key, overrides) };
			}),
			// The telemetry peer listens for its own keys, and says only the level.
			(e) => e.change.keys.length > 0 || e.change.overrides.length > 0 || e.affectsConfiguration("telemetry"),
		),
		updateValue: async () => { throw refusals.refuse(writes); },
		reloadConfiguration: async () => { throw refusals.refuse(writes); },
	});
}
