/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { REVIEW_DESKTOP_BACKGROUND_ENV } from "./reviewBackgroundLaunch.js";

export interface MoveToApplicationsContext {
	readonly platform: NodeJS.Platform;
	readonly isBuilt: boolean;
	readonly inApplicationsFolder: boolean;
	readonly declined: boolean;
	readonly env: NodeJS.ProcessEnv;
}

/**
 * Squirrel.Mac refuses every update while the app runs from a read-only
 * volume: an unmoved disk image, or the App Translocation copy macOS makes of
 * a quarantined app opened from Downloads. Asking at launch is the only way
 * out, because an install stuck there never receives a fix.
 */
export function shouldOfferMoveToApplications(context: MoveToApplicationsContext): boolean {
	if (context.platform !== "darwin" || !context.isBuilt) return false;
	if (context.inApplicationsFolder || context.declined) return false;
	// A launch from `whiteboard app` stays in the background; a modal would steal focus.
	if (context.env[REVIEW_DESKTOP_BACKGROUND_ENV] === "1") return false;
	const harness = context.env.DEV_FAST_REVIEW_TELEMETRY_ENV;
	return harness !== "e2e" && harness !== "smoke" && !context.env.CI;
}
