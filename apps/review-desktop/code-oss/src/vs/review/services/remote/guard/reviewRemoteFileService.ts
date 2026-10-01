/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { Schemas } from "../../../../base/common/network.js";
import type { URI } from "../../../../base/common/uri.js";
import { FileChangesEvent, FileChangeType, type IFileService } from "../../../../platform/files/common/files.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const READ_ELSEWHERE = "reading files outside this remote";
const WRITE_ELSEWHERE = "changing files outside this remote";
const WATCH_ELSEWHERE = "watching files outside this remote";

/**
 * Files of this host only. The laptop's disk (`file:`, which is what the
 * remote's `vscode-local:` arrives as), its profile and every other host's
 * files are refused, and their change events never reach the host.
 *
 * Its own files it may also change, as its extensions can with Node's `fs`
 * anyway: through `own`, its own connection, never the window's router, which
 * keeps every editor read-only.
 */
export function reviewRemoteFileService(base: IFileService, refusals: ReviewRemoteRefusals, own: IFileService): IFileService {
	const mine = (resource: URI) => refusals.owns(resource);
	const elsewhere = () => Promise.reject(refusals.refuse(READ_ELSEWHERE));
	const writable = (...resources: URI[]) => {
		if (!resources.every(mine)) throw refusals.refuse(WRITE_ELSEWHERE);
		return own;
	};
	return override(base, {
		writeFile: (resource, content, options) => writable(resource).writeFile(resource, content, options),
		move: (source, target, overwrite) => writable(source, target).move(source, target, overwrite),
		copy: (source, target, overwrite) => writable(source, target).copy(source, target, overwrite),
		cloneFile: (source, target) => writable(source, target).cloneFile(source, target),
		createFile: (resource, content, options) => writable(resource).createFile(resource, content, options),
		createFolder: (resource) => writable(resource).createFolder(resource),
		del: (resource, options) => writable(resource).del(resource, options),
		canMove: async (source, target, overwrite) => (mine(source) && mine(target) ? own.canMove(source, target, overwrite) : refusals.refuse(WRITE_ELSEWHERE)),
		canCopy: async (source, target, overwrite) => (mine(source) && mine(target) ? own.canCopy(source, target, overwrite) : refusals.refuse(WRITE_ELSEWHERE)),
		canCreateFile: async (resource, options) => (mine(resource) ? own.canCreateFile(resource, options) : refusals.refuse(WRITE_ELSEWHERE)),
		canDelete: async (resource, options) => (mine(resource) ? own.canDelete(resource, options) : refusals.refuse(WRITE_ELSEWHERE)),
		registerProvider: () => { throw refusals.refuse("registering a file system"); },
		// The router answers for every host; handing it out would skip this check.
		getProvider: () => undefined,
		activateProvider: async () => { },
		canHandleResource: async (resource) => mine(resource),
		hasProvider: (resource) => mine(resource),
		hasCapability: (resource, capability) => mine(resource) && own.hasCapability(resource, capability),
		listCapabilities: () => [...own.listCapabilities()].filter(({ scheme }) => scheme === Schemas.vscodeRemote),
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
		watch: (resource, options) => {
			if (!mine(resource)) throw refusals.refuse(WATCH_ELSEWHERE);
			return base.watch(resource, options);
		},
		createWatcher: (resource, options) => {
			if (!mine(resource)) throw refusals.refuse(WATCH_ELSEWHERE);
			return base.createWatcher(resource, options);
		},
	});
}
