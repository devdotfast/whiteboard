/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDownloadService } from "../../../../platform/download/common/download.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** A download would write a file the remote names onto the laptop. */
export class ReviewRemoteDownloadService implements IDownloadService {
	declare readonly _serviceBrand: undefined;

	constructor(@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals) { }

	async download(): Promise<void> {
		throw this.refusals.refuse("downloading");
	}
}
