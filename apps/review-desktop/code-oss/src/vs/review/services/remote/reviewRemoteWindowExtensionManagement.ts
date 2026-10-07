/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../base/common/event.js";
import type { IChannel } from "../../../base/parts/ipc/common/ipc.js";
import { WorkbenchExtensionGalleryManifestService } from "../../../workbench/services/extensionManagement/electron-browser/extensionGalleryManifestService.js";
import { ExtensionManagementServerService } from "../../../workbench/services/extensionManagement/electron-browser/extensionManagementServerService.js";
import type { IRemoteAgentService } from "../../../workbench/services/remote/common/remoteAgentService.js";
import { isReviewRemoteAuthority, override } from "./reviewRemoteAuthority.js";

const UNSERVED = new Set(["extensions", "extensionGalleryManifest"]);

/** The trimmed server manages no extensions. */
const NO_EXTENSIONS: IChannel = {
	call: async <T>(command: string): Promise<T> => {
		if (command === "getInstalled") return [] as T;
		if (command === "setExtensionGalleryManifest") return undefined as T;
		throw new Error(`Extensions on a Whiteboard remote are not managed from a Source window (${command}).`);
	},
	listen: <T>() => Event.None as Event<T>,
};

export function withoutRemoteExtensionManagement(remoteAgentService: IRemoteAgentService): IRemoteAgentService {
	const connection = remoteAgentService.getConnection();
	if (!connection || !isReviewRemoteAuthority(connection.remoteAuthority)) return remoteAgentService;
	const quiet = override(connection, {
		getChannel: <T extends IChannel>(name: string) => (UNSERVED.has(name) ? NO_EXTENSIONS : connection.getChannel(name)) as T,
	});
	return override(remoteAgentService, { getConnection: () => quiet });
}

export class ReviewExtensionManagementServerService extends ExtensionManagementServerService {
	constructor(...args: ConstructorParameters<typeof ExtensionManagementServerService>) {
		args[1] = withoutRemoteExtensionManagement(args[1]);
		super(...args);
	}
}

export class ReviewExtensionGalleryManifestService extends WorkbenchExtensionGalleryManifestService {
	constructor(...args: ConstructorParameters<typeof WorkbenchExtensionGalleryManifestService>) {
		args[5] = withoutRemoteExtensionManagement(args[5]);
		super(...args);
	}
}
