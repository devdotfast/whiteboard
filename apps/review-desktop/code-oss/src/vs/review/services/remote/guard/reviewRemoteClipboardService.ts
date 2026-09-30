/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IClipboardService } from "../../../../platform/clipboard/common/clipboardService.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** The laptop's clipboard is neither read nor written. */
export class ReviewRemoteClipboardService implements IClipboardService {
	declare readonly _serviceBrand: undefined;

	constructor(@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals) { }

	private refuse(): Promise<never> {
		return Promise.reject(this.refusals.refuse("using the clipboard"));
	}

	triggerPaste() { return this.refuse(); }
	writeText() { return this.refuse(); }
	readText() { return this.refuse(); }
	readFindText() { return this.refuse(); }
	writeFindText() { return this.refuse(); }
	writeResources() { return this.refuse(); }
	readResources() { return this.refuse(); }
	hasResources() { return this.refuse(); }
	readImage() { return this.refuse(); }
}
