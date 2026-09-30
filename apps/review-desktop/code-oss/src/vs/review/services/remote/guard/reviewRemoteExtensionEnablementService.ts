/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IWorkbenchExtensionEnablementService } from "../../../../workbench/services/extensionManagement/common/extensionManagement.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** A remote never enables or disables the laptop's extensions; reading their state is harmless. */
export function reviewRemoteExtensionEnablementService(base: IWorkbenchExtensionEnablementService, refusals: ReviewRemoteRefusals): IWorkbenchExtensionEnablementService {
	return override(base, {
		...refusals.refuseAll<IWorkbenchExtensionEnablementService>(["setEnablement", "updateExtensionsEnablementsWhenWorkspaceTrustChanges"], "managing the window's extensions"),
		canChangeEnablement: () => false,
		canChangeWorkspaceEnablement: () => false,
	});
}
