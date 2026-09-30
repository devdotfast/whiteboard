/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import type { ISecretStorageService } from "../../../../platform/secrets/common/secrets.js";
import { override } from "./reviewRemoteGuard.js";

/**
 * Secrets under the host's `whiteboard+<serverId>/` prefix only. Upstream's
 * peer trusts the extension id the host sends, so without this a host could
 * name any laptop extension and read its secrets.
 */
export function reviewRemoteSecretStorageService(base: ISecretStorageService, authority: string): ISecretStorageService {
	const prefix = `${authority}/`;
	const mine = (key: string) => key.startsWith(prefix);
	return override(base, {
		get: (key) => base.get(prefix + key),
		set: (key, value) => base.set(prefix + key, value),
		delete: (key) => base.delete(prefix + key),
		keys: async () => ((await base.keys?.()) ?? []).filter(mine).map((key) => key.slice(prefix.length)),
		onDidChangeSecret: Event.map(Event.filter(base.onDidChangeSecret, mine), (key) => key.slice(prefix.length)),
	});
}
