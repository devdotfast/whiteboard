/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { REVIEW_REMOTE_HOSTS_SETTING } from "../common/reviewConfigurationDefaults.js";
import type { ReviewRemoteHostsSettings } from "../common/reviewProtocol.js";
import { remoteHostAliases, validateSshAlias } from "../common/reviewSshAlias.js";
import type { IReviewDesktopConnectionService } from "../services/reviewDesktopConnectionService.js";

export function reviewRemoteHostsSettings(input: {
	get(key: string): unknown;
	update(key: string, value: string[]): Promise<void>;
	connection: Pick<IReviewDesktopConnectionService, "readRemoteHosts" | "listSshAliases" | "retryRemoteHost" | "installRemoteHost" | "detectRemoteAgents" | "connectRemoteAgents" | "uninstallRemoteHost">;
}): ReviewRemoteHostsSettings {
	const configured = () => remoteHostAliases(input.get(REVIEW_REMOTE_HOSTS_SETTING));
	return {
		configured: configured(),
		suggestions: () => input.connection.listSshAliases(),
		states: () => input.connection.readRemoteHosts(),
		retry: (alias) => input.connection.retryRemoteHost(alias),
		install: (alias) => input.connection.installRemoteHost(alias),
		agents: (alias, refresh) => input.connection.detectRemoteAgents(alias, refresh),
		connectAgents: (alias, agents) => input.connection.connectRemoteAgents(alias, agents),
		uninstall: (alias) => input.connection.uninstallRemoteHost(alias),
		set: async (aliases) => {
			for (const alias of aliases) {
				const valid = validateSshAlias(alias);
				if (!valid.ok) throw new Error(`The SSH alias ${JSON.stringify(alias)} ${valid.reason}.`);
			}
			await input.update(REVIEW_REMOTE_HOSTS_SETTING, [...new Set(aliases)]);
			return configured();
		},
	};
}
