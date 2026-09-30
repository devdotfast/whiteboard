/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEditSessionIdentityService } from "../../../../platform/workspace/common/editSessions.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** A provider would be asked about the window's workspace folders. */
export class ReviewRemoteEditSessionIdentityService implements IEditSessionIdentityService {
	declare readonly _serviceBrand: undefined;

	constructor(@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals) { }

	registerEditSessionIdentityProvider(): never {
		throw this.refusals.refuse("providing edit session identities to the window");
	}

	addEditSessionIdentityCreateParticipant(): never {
		throw this.refusals.refuse("providing edit session identities to the window");
	}

	async getEditSessionIdentifier() { return undefined; }
	async provideEditSessionIdentityMatch() { return undefined; }
	async onWillCreateEditSessionIdentity() { }
}
