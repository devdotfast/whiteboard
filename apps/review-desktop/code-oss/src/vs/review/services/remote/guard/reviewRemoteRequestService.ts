/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IRequestService } from "../../../../platform/request/common/request.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const KIND = "using the laptop's network settings";

/**
 * The laptop's proxy settings, proxy passwords, Kerberos tickets and
 * certificates stay on the laptop. The host's proxy agent asks for them on
 * every request, so it gets "none" rather than an error, and connects the way
 * the remote itself does.
 */
export function reviewRemoteRequestService(base: IRequestService, refusals: ReviewRemoteRefusals): IRequestService {
	const none = <T>(value: T) => async () => {
		refusals.refuse(KIND);
		return value;
	};
	return override(base, {
		...refusals.refuseAll<IRequestService>(["request"], KIND),
		resolveProxy: none(undefined),
		lookupAuthorization: none(undefined),
		lookupKerberosAuthorization: none(undefined),
		loadCertificates: none<string[]>([]),
	});
}
