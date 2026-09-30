/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from "../../../../base/common/network.js";
import type { IMarkerData, IMarkerService } from "../../../../platform/markers/common/markers.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * A diagnostic's code link is opened by the editor hover with commands
 * allowed, and a related location opens its file: a host's diagnostics keep
 * web code links only (the code stays as text) and related locations in its
 * own files only. Wraps the host's marker service from its scope.
 */
export function reviewRemoteDiagnostics(base: IMarkerService, refusals: ReviewRemoteRefusals): IMarkerService {
	const clean = (marker: IMarkerData): IMarkerData => {
		let result = marker;
		const code = marker.code;
		if (code && typeof code !== "string" && code.target.scheme !== Schemas.http && code.target.scheme !== Schemas.https) {
			refusals.refuse("diagnostic links other than http and https");
			result = { ...result, code: code.value };
		}
		const related = marker.relatedInformation?.filter((info) => refusals.owns(info.resource));
		if (related && related.length !== marker.relatedInformation!.length) {
			refusals.refuse("diagnostic locations outside this remote");
			result = { ...result, relatedInformation: related };
		}
		return result;
	};
	return override(base, {
		changeOne: (owner, resource, markers) => base.changeOne(owner, resource, markers.map(clean)),
		changeAll: (owner, data) => base.changeAll(owner, data.map((entry) => ({ ...entry, marker: clean(entry.marker) }))),
	});
}
