/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import type { IDecorationsService } from "../../../../workbench/services/decorations/common/decorations.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** A host decorates its own files only, so it never learns which laptop files the window shows. */
export function reviewRemoteDecorationsService(base: IDecorationsService, refusals: ReviewRemoteRefusals): IDecorationsService {
	const mine = refusals.owns.bind(refusals);
	return override(base, {
		registerDecorationsProvider: (provider) => base.registerDecorationsProvider({
			label: provider.label,
			onDidChange: Event.filter(Event.map(provider.onDidChange, (resources) => resources.filter(mine)), (resources) => resources.length > 0),
			provideDecorations: (uri, token) => (mine(uri) ? provider.provideDecorations(uri, token) : undefined),
		}),
	});
}
