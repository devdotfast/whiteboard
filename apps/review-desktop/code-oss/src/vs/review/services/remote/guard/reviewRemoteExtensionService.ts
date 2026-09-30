/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionIdentifier, type IExtensionDescription } from "../../../../platform/extensions/common/extensions.js";
import type { IExtensionService } from "../../../../workbench/services/extensions/common/extensions.js";
import { override } from "./reviewRemoteGuard.js";

/**
 * Activation goes to this host's extension host, never the laptop's: a search
 * activates `onSearch:*` here. Extension lookups answer with this host's own
 * extensions, not the laptop's descriptions and their paths.
 */
export function reviewRemoteExtensionService(
	base: IExtensionService,
	extensions: readonly IExtensionDescription[],
	activate: (event: string) => Promise<void>,
): IExtensionService {
	const byId = new Map(extensions.map((extension) => [ExtensionIdentifier.toKey(extension.identifier), extension]));
	return override(base, {
		extensions,
		activateByEvent: (event) => activate(event),
		activationEventIsDone: () => false,
		whenInstalledExtensionsRegistered: async () => true,
		getExtension: async (id) => byId.get(ExtensionIdentifier.toKey(id)),
	});
}
