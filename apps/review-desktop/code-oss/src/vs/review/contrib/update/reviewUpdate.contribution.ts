/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Review's update notices and commands to check on demand and to show the
 * release notes. The canvas update pill announces a pending update; this
 * records it and confirms once it has landed.
 *
 * Review deliberately omits the stock `workbench/contrib/update` — its title bar
 * entry depends on the chat service, which Review does not register.
 */

import { localize, localize2 } from '../../../nls.js';
import { toAction } from '../../../base/common/actions.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import Severity from '../../../base/common/severity.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import type { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import {
	darwinFailedUpdateNoticeId,
	isDarwinAuthorizationError,
	isDarwinReadOnlyVolumeError,
	DARWIN_FAILED_UPDATE_STORAGE_KEY,
	parseDarwinFailedUpdate,
	shouldAnnounceDarwinFailedUpdate,
} from '../../../platform/update/common/darwinUpdateRecovery.js';
import { IUpdateService, StateType, type State } from '../../../platform/update/common/update.js';
import { REVIEW_SHOW_RELEASE_NOTES_SETTING } from '../../common/reviewConfigurationDefaults.js';
import { REVIEW_DESKTOP_CHANNEL } from '../../common/reviewDesktopBootstrap.js';
import { WHITEBOARD_RELEASES_URL } from '../../common/reviewProtocol.js';
import { REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID } from '../../common/reviewReleaseNotes.js';
import { IReviewCanvasEditorTabsService } from '../../services/reviewCanvasEditorTabsService.js';
import { IReviewTelemetryService } from '../../services/reviewTelemetryService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../workbench/common/contributions.js';
import {
	decideUpdateNotice,
	parseStagedUpdate,
	serializeStagedUpdate,
	stagedUpdateFromReady,
	supersedesStagedUpdate,
} from '../../common/reviewUpdateNotice.js';

/** The update downloaded and waiting for a restart. */
const STAGED_UPDATE_STORAGE_KEY = 'review.update.staged.v1';
/** Failed update attempt that Review already announced. */
const FAILED_UPDATE_NOTICE_STORAGE_KEY = 'review.update.failedNotice.v1';

class ReviewUpdateNotifications extends Disposable {

	static readonly ID = 'review.update.notifications';

	private announcedReadOnlyVolume = false;
	private announcedAuthorizationFailure = false;

	constructor(
		@IUpdateService private readonly updateService: IUpdateService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		this.announceFailedUpdate();
		void this.announceCompletedUpdate();
		this._register(this.storageService.onDidChangeValue(
			StorageScope.APPLICATION,
			DARWIN_FAILED_UPDATE_STORAGE_KEY,
			this._store,
		)(() => this.announceFailedUpdate()));

		this._register(this.updateService.onStateChange(state => {
			this.announceFailedUpdate();
			this.onStateChange(state);
		}));
		// The channel client replays its initial state, but reading it directly
		// keeps this correct regardless of when the contribution is created.
		this.onStateChange(this.updateService.state);
	}

	private announceFailedUpdate(): void {
		const failure = parseDarwinFailedUpdate(
			this.storageService.get(DARWIN_FAILED_UPDATE_STORAGE_KEY, StorageScope.APPLICATION),
		);
		const announcedNoticeId = this.storageService.get(
			FAILED_UPDATE_NOTICE_STORAGE_KEY,
			StorageScope.APPLICATION,
		);
		if (!shouldAnnounceDarwinFailedUpdate(failure, this.productService.commit, announcedNoticeId)) {
			return;
		}

		this.storageService.store(
			FAILED_UPDATE_NOTICE_STORAGE_KEY,
			darwinFailedUpdateNoticeId(failure),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		this.logService.error(`[WhiteboardUpdate] update failed (${failure.targetCommit})`);
		this.notificationService.notify({
			severity: Severity.Error,
			message: localize('review.update.installFailed', "Update failed"),
		});
	}

	/**
	 * If this launch is the first one on a build we staged, say so — once: with
	 * the Release notes tab when it is on, else a toast.
	 *
	 * The record is cleared whether or not it matched: a record for some other
	 * build is stale (a hand-installed DMG, or an abandoned update) and should
	 * disappear silently rather than linger and fire later.
	 */
	private async announceCompletedUpdate(): Promise<void> {
		const staged = parseStagedUpdate(
			this.storageService.get(STAGED_UPDATE_STORAGE_KEY, StorageScope.APPLICATION),
		);
		const notice = decideUpdateNotice(staged, this.productService.commit);
		if (notice.kind === 'none') {
			return;
		}

		this.storageService.remove(STAGED_UPDATE_STORAGE_KEY, StorageScope.APPLICATION);
		if (notice.kind === 'clear') {
			return;
		}

		this.logService.info(`[WhiteboardUpdate] running the staged update (${this.productService.commit})`);
		const version = this.productService.reviewVersion ?? notice.productVersion;
		if (version && this.configurationService.getValue<boolean>(REVIEW_SHOW_RELEASE_NOTES_SETTING) !== false) {
			await this.commandService.executeCommand(REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID, version, 'update');
			return;
		}
		this.notificationService.notify({
			severity: Severity.Info,
			message: notice.productVersion
				? localize('review.update.applied', "Whiteboard updated to {0}.", notice.productVersion)
				: localize('review.update.applied.unknownVersion', "Whiteboard has been updated."),
			actions: { primary: [toAction({
				id: 'review.update.releaseNotes', label: localize('review.update.whatsNew', "What's New"),
				run: () => this.commandService.executeCommand(REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID, version, 'toast'),
			})] },
		});
	}

	/** Warns about macOS install failures and records an update once it is `Ready`. */
	private onStateChange(state: State): void {
		if (isMacintosh && state.type === StateType.Idle && isDarwinAuthorizationError(state.error)) {
			if (!this.announcedAuthorizationFailure) {
				this.announcedAuthorizationFailure = true;
				this.notificationService.notify({
					severity: Severity.Warning,
					sticky: true,
					message: localize('review.update.authorizationFailed', "Whiteboard couldn't install an update because macOS didn't get administrator approval. Choose Check for Updates and enter an administrator password when asked."),
				});
			}
			return;
		}
		if (isMacintosh && state.type === StateType.Idle && isDarwinReadOnlyVolumeError(state.error)) {
			if (!this.announcedReadOnlyVolume) {
				this.announcedReadOnlyVolume = true;
				this.notificationService.notify({
					severity: Severity.Warning,
					sticky: true,
					message: localize('review.update.readOnlyVolume', "Whiteboard cannot update from its current location. Quit Whiteboard, use Finder to copy or move Whiteboard to your Applications folder, then open it from there. If you opened Whiteboard from a disk image, eject the disk image after copying the app."),
					actions: { primary: [toAction({
						id: 'review.update.moveToApplications', label: localize('review.update.moveToApplications', "Move to Applications"),
						// On success the app quits and relaunches from Applications.
						run: () => this.mainProcessService.getChannel(REVIEW_DESKTOP_CHANNEL).call<boolean>('moveToApplications').then(moved => {
							if (!moved) { this.logService.warn('[WhiteboardUpdate] could not move Whiteboard to Applications'); }
						}),
					})] },
				});
			}
			return;
		}
		if (state.type !== StateType.Ready) {
			return;
		}

		const next = stagedUpdateFromReady(state.update);
		if (!next) {
			this.logService.warn('[WhiteboardUpdate] update is ready but carries no commit; nothing to record');
			return;
		}

		const staged = parseStagedUpdate(
			this.storageService.get(STAGED_UPDATE_STORAGE_KEY, StorageScope.APPLICATION),
		);
		if (supersedesStagedUpdate(staged, next)) {
			this.storageService.store(
				STAGED_UPDATE_STORAGE_KEY,
				serializeStagedUpdate(next),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);
		}
	}
}

/**
 * Checking on demand. Without this the only trigger is the scheduled check, 30
 * seconds after startup and hourly after that. An explicit check also bypasses
 * the metered-connection path, so macOS can download immediately; Linux still uses the package manager.
 */
class ReviewCheckForUpdatesAction extends Action2 {

	constructor() {
		super({
			id: 'review.checkForUpdates',
			title: localize2('review.checkForUpdates', "Check for Updates..."),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IUpdateService).checkForUpdates(true);
	}
}

class ReviewShowReleaseNotesAction extends Action2 {

	constructor() {
		super({
			id: REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID,
			title: localize2('review.showReleaseNotes', "Whiteboard: Show Release Notes"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, version?: unknown, via: unknown = 'command'): Promise<void> {
		const shown = typeof version === 'string' && version ? version : accessor.get(IProductService).reviewVersion;
		if (!shown) {
			await accessor.get(IOpenerService).open(WHITEBOARD_RELEASES_URL, { openExternal: true });
			return;
		}
		accessor.get(IReviewTelemetryService).capture('release_notes_opened', { via: String(via), version: shown });
		await accessor.get(IReviewCanvasEditorTabsService).openReleaseNotes(shown, true);
	}
}

registerAction2(ReviewCheckForUpdatesAction);
registerAction2(ReviewShowReleaseNotesAction);
registerWorkbenchContribution2(
	ReviewUpdateNotifications.ID,
	ReviewUpdateNotifications,
	WorkbenchPhase.AfterRestored,
);
