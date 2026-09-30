/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IWorkspaceTrustRequestService } from "../../../../platform/workspace/common/workspaceTrust.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** Trust is the laptop's own workspace and folders; a remote may not ask the user for it. */
export function reviewRemoteWorkspaceTrustRequestService(base: IWorkspaceTrustRequestService, refusals: ReviewRemoteRefusals): IWorkspaceTrustRequestService {
	return override(base, refusals.refuseAll<IWorkspaceTrustRequestService>(
		["requestWorkspaceTrust", "requestResourcesTrust", "requestOpenFilesTrust"],
		"asking for trust in the window",
	));
}
