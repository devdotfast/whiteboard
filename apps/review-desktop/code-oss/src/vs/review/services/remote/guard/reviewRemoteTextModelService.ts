/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITextModelService } from "../../../../editor/common/services/resolverService.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Opens this host's files only. A content provider would answer the window's
 * requests for its scheme, so a host cannot register one.
 */
export function reviewRemoteTextModelService(base: ITextModelService, refusals: ReviewRemoteRefusals): ITextModelService {
	return override(base, {
		createModelReference: async (resource) => {
			if (!refusals.owns(resource)) throw refusals.refuse("opening documents outside this remote");
			return base.createModelReference(resource);
		},
		canHandleResource: (resource) => refusals.owns(resource) && base.canHandleResource(resource),
		registerTextModelContentProvider: () => {
			throw refusals.refuse("registering a document content provider");
		},
	});
}
