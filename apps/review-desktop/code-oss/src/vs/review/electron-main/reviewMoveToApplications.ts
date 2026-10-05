/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app } from "electron";

import { Disposable } from "../../base/common/lifecycle.js";
import { localize } from "../../nls.js";
import { IDialogMainService } from "../../platform/dialogs/electron-main/dialogMainService.js";
import { IEnvironmentMainService } from "../../platform/environment/electron-main/environmentMainService.js";
import {
	ILifecycleMainService,
	LifecycleMainPhase,
} from "../../platform/lifecycle/electron-main/lifecycleMainService.js";
import { ILogService } from "../../platform/log/common/log.js";
import {
	StorageScope,
	StorageTarget,
} from "../../platform/storage/common/storage.js";
import { IApplicationStorageMainService } from "../../platform/storage/electron-main/storageMainService.js";
import { shouldOfferMoveToApplications } from "./reviewMoveToApplicationsPolicy.js";

const DECLINED_STORAGE_KEY = "review/moveToApplications/declined.v1";

/** Moves the running app into /Applications and relaunches it from there. False if it stayed put. */
export function moveToApplicationsFolder(logService: ILogService): boolean {
	try {
		return app.moveToApplicationsFolder();
	} catch (error) {
		logService.error("reviewMoveToApplications#move failed", error);
		return false;
	}
}

export class ReviewMoveToApplications extends Disposable {
	constructor(
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IApplicationStorageMainService private readonly storage: IApplicationStorageMainService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		lifecycleMainService
			.when(LifecycleMainPhase.AfterWindowOpen)
			.then(() => this.storage.whenReady)
			.then(() => this.offer())
			.catch((error) => this.logService.error("reviewMoveToApplications#offer failed", error));
	}

	private async offer(): Promise<void> {
		const offer = shouldOfferMoveToApplications({
			platform: process.platform,
			isBuilt: this.environmentMainService.isBuilt,
			inApplicationsFolder: process.platform === "darwin" && app.isInApplicationsFolder(),
			declined: this.storage.get(DECLINED_STORAGE_KEY, StorageScope.APPLICATION) === "true",
			env: process.env,
		});
		if (!offer) return;

		const { response } = await this.dialogMainService.showMessageBox({
			type: "question",
			buttons: [
				localize({ key: "review.moveToApplications.move", comment: ["&& denotes a mnemonic"] }, "&&Move to Applications"),
				localize("review.moveToApplications.notNow", "Not Now"),
			],
			cancelId: 1,
			message: localize("review.moveToApplications.message", "Move Whiteboard to your Applications folder?"),
			detail: localize("review.moveToApplications.detail", "Whiteboard cannot install updates while it runs from a disk image or your Downloads folder. Whiteboard will restart from Applications."),
		});
		if (response === 0 && moveToApplicationsFolder(this.logService)) return;
		// The read-only update notice still offers the move if updates fail.
		this.storage.store(DECLINED_STORAGE_KEY, "true", StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
