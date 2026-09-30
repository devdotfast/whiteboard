/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { Disposable } from "../../../../base/common/lifecycle.js";
import { Schemas } from "../../../../base/common/network.js";
import type { URI } from "../../../../base/common/uri.js";
import { FileChangesEvent, FileChangeType, type IFileService } from "../../../../platform/files/common/files.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const READ_ELSEWHERE = "reading files outside this remote";
const WRITE = "changing files";

/**
 * Files of this host only, read-only. The laptop's disk (`file:`, which is
 * what the remote's `vscode-local:` arrives as), its profile and every other
 * host's files are refused, and their change events never reach the host.
 */
export function reviewRemoteFileService(base: IFileService, refusals: ReviewRemoteRefusals): IFileService {
	const mine = (resource: URI) => refusals.owns(resource);
	const elsewhere = () => Promise.reject(refusals.refuse(READ_ELSEWHERE));
	return override(base, {
		...refusals.refuseAll<IFileService>(["writeFile", "move", "copy", "cloneFile", "createFile", "createFolder", "del"], WRITE),
		canMove: async () => refusals.refuse(WRITE),
		canCopy: async () => refusals.refuse(WRITE),
		canCreateFile: async () => refusals.refuse(WRITE),
		canDelete: async () => refusals.refuse(WRITE),
		registerProvider: () => { throw refusals.refuse("registering a file system"); },
		// The router answers for every host; handing it out would skip this check.
		getProvider: () => undefined,
		activateProvider: async () => { },
		canHandleResource: async (resource) => mine(resource),
		hasProvider: (resource) => mine(resource),
		hasCapability: (resource, capability) => mine(resource) && base.hasCapability(resource, capability),
		listCapabilities: () => [...base.listCapabilities()].filter(({ scheme }) => scheme === Schemas.vscodeRemote),
		onDidChangeFileSystemProviderRegistrations: Event.filter(base.onDidChangeFileSystemProviderRegistrations, (e) => e.scheme === Schemas.vscodeRemote),
		onDidChangeFileSystemProviderCapabilities: Event.filter(base.onDidChangeFileSystemProviderCapabilities, (e) => e.scheme === Schemas.vscodeRemote),
		onWillActivateFileSystemProvider: Event.None,
		onDidWatchError: Event.None,
		onDidFilesChange: Event.filter(Event.map(base.onDidFilesChange, (e) => {
			const changes = [
				...e.rawAdded.filter(mine).map((resource) => ({ resource, type: FileChangeType.ADDED })),
				...e.rawUpdated.filter(mine).map((resource) => ({ resource, type: FileChangeType.UPDATED })),
				...e.rawDeleted.filter(mine).map((resource) => ({ resource, type: FileChangeType.DELETED })),
			];
			return new FileChangesEvent(changes, false);
		}), (e) => e.rawAdded.length + e.rawUpdated.length + e.rawDeleted.length > 0),
		onDidRunOperation: Event.filter(base.onDidRunOperation, (e) => mine(e.resource) && (!e.target || mine(e.target.resource))),
		resolve: ((resource: URI, options?: object) => (mine(resource) ? base.resolve(resource, options) : elsewhere())) as IFileService["resolve"],
		resolveAll: async (entries) => {
			if (!entries.every(({ resource }) => mine(resource))) throw refusals.refuse(READ_ELSEWHERE);
			return base.resolveAll(entries);
		},
		stat: (resource) => (mine(resource) ? base.stat(resource) : elsewhere()),
		realpath: (resource) => (mine(resource) ? base.realpath(resource) : elsewhere()),
		exists: (resource) => (mine(resource) ? base.exists(resource) : elsewhere()),
		readFile: (resource, options, token) => (mine(resource) ? base.readFile(resource, options, token) : elsewhere()),
		readFileStream: (resource, options, token) => (mine(resource) ? base.readFileStream(resource, options, token) : elsewhere()),
		watch: (resource, options) => (mine(resource) ? base.watch(resource, options) : Disposable.None),
		createWatcher: (resource, options) => {
			if (!mine(resource)) throw refusals.refuse("watching files outside this remote");
			return base.createWatcher(resource, options);
		},
	});
}
