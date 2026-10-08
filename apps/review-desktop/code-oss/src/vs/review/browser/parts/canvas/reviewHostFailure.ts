/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import Severity from "../../../../base/common/severity.js";
import type { INotificationService } from "../../../../platform/notification/common/notification.js";
import { reviewHostStatus, type ReviewGatewayHostState } from "../../../common/reviewProtocol.js";

type HostDown = Pick<ReviewGatewayHostState, "alias" | "state" | "detail">;

export class ReviewHostDown extends Error {
	constructor(readonly host: HostDown) {
		super(reviewHostStatus(host).sentence);
	}
}

export function notifyOpenFailure(notifications: INotificationService, retry: (alias: string) => Promise<void>, error: unknown): void {
	if (!(error instanceof ReviewHostDown)) {
		notifications.error(error instanceof Error ? error : String(error));
		return;
	}
	const { alias } = error.host;
	const choices = reviewHostStatus(error.host).action === "retry"
		? [{ label: "Retry", run: () => void retry(alias).catch(retryError => notifications.error(retryError)) }]
		: [];
	notifications.prompt(Severity.Warning, error.message, choices);
}
