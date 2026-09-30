/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../../base/common/lifecycle.js";
import type { IBulkEditResult, IBulkEditService } from "../../../../editor/browser/services/bulkEditService.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Reviews are read-only: no workspace edits, which also carry file creates,
 * deletes and renames, and no edits from save or file-operation participants.
 */
export class ReviewRemoteBulkEditService implements IBulkEditService {
	declare readonly _serviceBrand: undefined;

	constructor(@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals) { }

	hasPreviewHandler(): boolean {
		return false;
	}

	setPreviewHandler() {
		return Disposable.None;
	}

	async apply(): Promise<IBulkEditResult> {
		throw this.refusals.refuse("editing documents or files");
	}
}
