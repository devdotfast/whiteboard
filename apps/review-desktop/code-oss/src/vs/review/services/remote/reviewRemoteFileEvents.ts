/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../base/common/event.js";
import type { URI } from "../../../base/common/uri.js";
import { FileChangesEvent, FileChangeType, type IFileService } from "../../../platform/files/common/files.js";
import { override, ownsRemoteResource } from "./reviewRemoteAuthority.js";

/** Only this host's file events: upstream's URI transformer drops the authority, so another host's change to the same path would look like its own. */
export function reviewRemoteFileEvents(base: IFileService, authority: string): IFileService {
	const mine = (resource: URI) => ownsRemoteResource(authority, resource);
	return override(base, {
		onDidFilesChange: Event.filter(Event.map(base.onDidFilesChange, (e) => new FileChangesEvent([
			...e.rawAdded.filter(mine).map((resource) => ({ resource, type: FileChangeType.ADDED })),
			...e.rawUpdated.filter(mine).map((resource) => ({ resource, type: FileChangeType.UPDATED })),
			...e.rawDeleted.filter(mine).map((resource) => ({ resource, type: FileChangeType.DELETED })),
		], false)), (e) => e.rawAdded.length + e.rawUpdated.length + e.rawDeleted.length > 0),
		onDidRunOperation: Event.filter(base.onDidRunOperation, (e) => mine(e.resource) && (!e.target || mine(e.target.resource))),
	});
}
