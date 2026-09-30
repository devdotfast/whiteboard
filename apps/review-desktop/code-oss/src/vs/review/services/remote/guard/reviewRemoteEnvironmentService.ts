/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEnvironmentService } from "../../../../platform/environment/common/environment.js";
import { override } from "./reviewRemoteGuard.js";

/**
 * The extension host start and its init data read these: without the
 * override a host would get the laptop's extension development paths, its
 * debug environment variables, and an inspector port in dev builds.
 */
export function reviewRemoteEnvironmentService<T extends IEnvironmentService>(base: T): T {
	return override(base, {
		debugExtensionHost: { port: null, break: false },
		isExtensionDevelopment: false,
		extensionDevelopmentLocationURI: undefined,
		extensionTestsLocationURI: undefined,
	} as Partial<T>);
}
