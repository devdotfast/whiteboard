/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { Disposable } from "../../../../base/common/lifecycle.js";
import type { IWorkingCopyFileService, WorkingCopyFileEvent } from "../../../../workbench/services/workingCopy/common/workingCopyFileService.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * The laptop's file creates, renames and deletes are neither sent to a host
 * nor held up by it: the peers' participants and providers are never
 * registered, and events name this host's files only.
 */
export function reviewRemoteWorkingCopyFileService(base: IWorkingCopyFileService, refusals: ReviewRemoteRefusals): IWorkingCopyFileService {
	const mine = (e: WorkingCopyFileEvent) => e.files.every(({ source, target }) => (!source || refusals.owns(source)) && refusals.owns(target));
	return override(base, {
		...refusals.refuseAll<IWorkingCopyFileService>(["create", "createFolder", "move", "copy", "delete"], "changing files"),
		addFileOperationParticipant: () => Disposable.None,
		addSaveParticipant: () => Disposable.None,
		registerWorkingCopyProvider: () => Disposable.None,
		onWillRunWorkingCopyFileOperation: Event.filter(base.onWillRunWorkingCopyFileOperation, mine),
		onDidRunWorkingCopyFileOperation: Event.filter(base.onDidRunWorkingCopyFileOperation, mine),
		onDidFailWorkingCopyFileOperation: Event.filter(base.onDidFailWorkingCopyFileOperation, mine),
	});
}
