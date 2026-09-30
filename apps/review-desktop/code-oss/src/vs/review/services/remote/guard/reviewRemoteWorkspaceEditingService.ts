/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import type { IWorkspaceEditingService } from "../../../../workbench/services/workspaces/common/workspaceEditing.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** `workspace.updateWorkspaceFolders` would change the laptop's workspace. */
export class ReviewRemoteWorkspaceEditingService implements IWorkspaceEditingService {
	declare readonly _serviceBrand: undefined;
	readonly onDidEnterWorkspace = Event.None;

	constructor(@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals) { }

	private refuse(): Promise<never> {
		return Promise.reject(this.refusals.refuse("changing the window's workspace"));
	}

	addFolders() { return this.refuse(); }
	removeFolders() { return this.refuse(); }
	updateFolders() { return this.refuse(); }
	enterWorkspace() { return this.refuse(); }
	createAndEnterWorkspace() { return this.refuse(); }
	saveAndEnterWorkspace() { return this.refuse(); }
	copyWorkspaceSettings() { return this.refuse(); }
	pickNewWorkspacePath() { return this.refuse(); }
}
