/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IProgressService } from "../../../../platform/progress/common/progress.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Progress is shown as a notification, whose title and messages the window
 * renders with links it opens with commands allowed. A remote's keep only web
 * and mail links.
 */
export function reviewRemoteProgressService(base: IProgressService, refusals: ReviewRemoteRefusals): IProgressService {
	const text = (value: string | undefined) => (value === undefined ? undefined : refusals.text(value));
	return override(base, {
		withProgress: (options, task, onDidCancel) =>
			base.withProgress(
				{ ...options, title: text(options.title) },
				(progress) => task({ report: (step) => progress.report({ ...step, message: text(step.message) }) }),
				onDidCancel,
			),
	});
}
