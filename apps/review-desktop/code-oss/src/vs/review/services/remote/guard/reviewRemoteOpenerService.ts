/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesSomeScheme, Schemas } from "../../../../base/common/network.js";
import type { IOpenerService } from "../../../../platform/opener/common/opener.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const WEB = [Schemas.http, Schemas.https];

/**
 * Web and mail links only, through the window's own opener. A file, an app,
 * a command link or any other scheme would run something on the laptop.
 */
export function reviewRemoteOpenerService(base: IOpenerService, refusals: ReviewRemoteRefusals): IOpenerService {
	const refuseLink = () => refusals.refuse("opening links other than http, https and mailto");
	return override(base, {
		...refusals.refuseAll<IOpenerService>(
			["registerOpener", "registerValidator", "registerExternalUriResolver", "setDefaultExternalOpener", "registerExternalOpener"],
			"changing how the window opens links",
		),
		open: async (target) => {
			if (!matchesSomeScheme(target, ...WEB, Schemas.mailto)) throw refuseLink();
			// No command links, contributed openers or skipped validation.
			return base.open(target, { openExternal: true });
		},
		resolveExternalUri: async (resource) => {
			if (!matchesSomeScheme(resource, ...WEB)) throw refuseLink();
			return base.resolveExternalUri(resource);
		},
	});
}
