/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from "../../../../base/common/uuid.js";
import type { ITelemetryService } from "../../../../platform/telemetry/common/telemetry.js";
import { override } from "./reviewRemoteGuard.js";

const REMOTE = "whiteboard-remote";

/**
 * A host gets the user's telemetry level, but none of the laptop's ids, and
 * its extensions' events are not sent as Whiteboard's own.
 */
export function reviewRemoteTelemetryService(base: ITelemetryService): ITelemetryService {
	return override(base, {
		sessionId: generateUuid(),
		machineId: REMOTE,
		sqmId: "",
		devDeviceId: REMOTE,
		firstSessionDate: "",
		msftInternal: false,
		publicLog: () => { },
		publicLog2: () => { },
		publicLogError: () => { },
		publicLogError2: () => { },
		setExperimentProperty: () => { },
		setCommonProperty: () => { },
	});
}
