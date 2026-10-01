/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../../base/common/lifecycle.js";
import type { ILanguageStatusService } from "../../../../workbench/services/languageStatus/common/languageStatusService.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * A language status item carries a command and a detail with links, and the
 * window's registry is shared by every host. The fork shows none today; a
 * remote's are dropped, so a later language status bar cannot run them. The
 * peer's call is fire-and-forget, so the refusal is logged, not thrown.
 */
export function reviewRemoteLanguageStatusService(base: ILanguageStatusService, refusals: ReviewRemoteRefusals): ILanguageStatusService {
	return override(base, {
		addStatus: () => {
			refusals.refuse("showing language status items");
			return Disposable.None;
		},
	});
}
