/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { INotificationService, NotificationMessage } from "../../../../platform/notification/common/notification.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Notifications stay allowed, but the window renders `[label](target)` in a
 * message as a link it opens with commands allowed. A remote's messages keep
 * only web and mail links.
 */
export function reviewRemoteNotificationService(base: INotificationService, refusals: ReviewRemoteRefusals): INotificationService {
	const message = (value: NotificationMessage): NotificationMessage =>
		typeof value === "string" ? refusals.text(value) : new Error(refusals.text(value.message));
	const messages = (value: NotificationMessage | NotificationMessage[]) => (Array.isArray(value) ? value.map(message) : message(value));
	return override(base, {
		notify: (notification) => base.notify({ ...notification, message: message(notification.message) }),
		info: (value) => base.info(messages(value)),
		warn: (value) => base.warn(messages(value)),
		error: (value) => base.error(messages(value)),
		prompt: (severity, value, choices, options) => base.prompt(severity, refusals.text(value), choices, options),
		status: (value, options) => base.status(message(value), options),
	});
}
