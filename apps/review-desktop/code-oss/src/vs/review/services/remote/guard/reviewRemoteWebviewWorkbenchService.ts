/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../../base/common/lifecycle.js";
import { createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import type { IWebviewWorkbenchService } from "../../../../workbench/contrib/webviewPanel/browser/webviewWorkbenchService.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Upstream's identifier, by its id: the module that declares it needs a DOM,
 * so importing it would keep the scope out of Node tests. Identifiers are
 * shared by id, and the test checks this is the same one.
 */
export const IWebviewWorkbenchServiceId = createDecorator<IWebviewWorkbenchService>("webviewEditorService");

/**
 * No webview panels or custom editors: a webview runs the remote's HTML in
 * the window, with command links and local resources. The peers register
 * their revivers when they start, so those are dropped without an error.
 */
export function reviewRemoteWebviewWorkbenchService(base: IWebviewWorkbenchService, refusals: ReviewRemoteRefusals): IWebviewWorkbenchService {
	return override(base, {
		...refusals.refuseAll<IWebviewWorkbenchService>(["openWebview", "openRevivedWebview", "revealWebview", "resolveWebview"], "showing webviews"),
		registerResolver: () => Disposable.None,
	});
}
