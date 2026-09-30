/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ILabelService } from "../../../../platform/label/common/label.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** A formatter would change how the window labels the laptop's files, or pass one host off as another. */
export function reviewRemoteLabelService(base: ILabelService, refusals: ReviewRemoteRefusals): ILabelService {
	return override(base, refusals.refuseAll<ILabelService>(["registerFormatter", "registerCachedFormatter"], "changing how the window labels files"));
}
