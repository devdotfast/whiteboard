/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICanonicalUriService } from "../../../../platform/workspace/common/canonicalUri.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** A provider would be asked about the laptop's files. */
export class ReviewRemoteCanonicalUriService implements ICanonicalUriService {
	declare readonly _serviceBrand: undefined;

	constructor(@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals) { }

	registerCanonicalUriProvider(): never {
		throw this.refusals.refuse("providing canonical URIs to the window");
	}
}
