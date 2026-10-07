/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable, type IDisposable } from "../../../base/common/lifecycle.js";
import Severity from "../../../base/common/severity.js";
import { IMainProcessService } from "../../../platform/ipc/common/mainProcessService.js";
import { INotificationService, type INotificationHandle } from "../../../platform/notification/common/notification.js";
import { PersistentConnectionEventType } from "../../../platform/remote/common/remoteAgentConnection.js";
import type { IWorkbenchContribution } from "../../../workbench/common/contributions.js";
import { IWorkbenchEnvironmentService } from "../../../workbench/services/environment/common/environmentService.js";
import { IRemoteAgentService, type IRemoteAgentConnection } from "../../../workbench/services/remote/common/remoteAgentService.js";
import { IStatusbarService, StatusbarAlignment, type IStatusbarEntry, type IStatusbarEntryAccessor } from "../../../workbench/services/statusbar/browser/statusbar.js";
import { IStorageService, StorageScope } from "../../../platform/storage/common/storage.js";
import { REVIEW_DESKTOP_CHANNEL } from "../../common/reviewDesktopBootstrap.js";
import { isReviewSourceTitle, REVIEW_SOURCE_TITLE_KEY } from "../configuration/reviewSourceWindowConfiguration.js";
import { isReviewRemoteAuthority } from "./reviewRemoteAuthority.js";
import { reviewWindowHosts, type ReviewWindowHosts } from "./reviewWindowAuthorityResolver.js";

export const HOST_STATE_POLL_MS = 2_000;

/** Shows a Source window's host as main sees it: its alias, or that it is offline and the window is reconnecting. */
export function showSourceWindowHostState(
	serverId: string,
	hosts: ReviewWindowHosts,
	statusbar: IStatusbarService,
	notifications: INotificationService,
	connection: Pick<IRemoteAgentConnection, "onDidStateChange"> | null,
	storedAlias: () => string | undefined = () => undefined,
	every = HOST_STATE_POLL_MS,
): IDisposable {
	const store = new DisposableStore();
	let mainAlias: string | undefined;
	let known = false;
	let online = true;
	let lost = false;
	let notified = false;
	let entry: IStatusbarEntryAccessor | undefined;
	let notice: INotificationHandle | undefined;
	const render = () => {
		if (!known) return;
		const alias = mainAlias ?? storedAlias() ?? serverId.slice(0, 8);
		const offline = !online || lost;
		const text = offline ? `${alias} — offline, reconnecting…` : alias;
		const props: IStatusbarEntry = { name: "Remote Host", text, ariaLabel: text, kind: offline ? "warning" : undefined };
		if (entry) entry.update(props);
		else entry = store.add(statusbar.addEntry(props, "review.sourceWindow.host", StatusbarAlignment.LEFT, Number.MAX_VALUE));
		if (offline && !notified) {
			notified = true;
			notice = notifications.notify({ severity: Severity.Warning, message: `${alias} is offline. The window reconnects when it is back.` });
		} else if (!offline) {
			notice?.close();
			notice = undefined;
		}
	};
	if (connection) {
		store.add(connection.onDidStateChange(({ type }) => {
			lost = type !== PersistentConnectionEventType.ConnectionGain;
			render();
		}));
	}
	let stopped = false;
	let handle: ReturnType<typeof setTimeout> | undefined;
	const tick = async () => {
		const state = await hosts.state(serverId).catch(() => undefined);
		if (stopped) return;
		if (state) {
			mainAlias = state.alias ?? mainAlias;
			online = state.state === "online";
			known = true;
			render();
		}
		handle = setTimeout(() => void tick(), every);
	};
	void tick();
	store.add(toDisposable(() => {
		stopped = true;
		clearTimeout(handle);
	}));
	return store;
}

export class ReviewSourceWindowHostState extends Disposable implements IWorkbenchContribution {
	static readonly ID = "review.sourceWindow.hostState";

	constructor(
		@IWorkbenchEnvironmentService environment: IWorkbenchEnvironmentService,
		@IMainProcessService mainProcess: IMainProcessService,
		@IStatusbarService statusbar: IStatusbarService,
		@INotificationService notifications: INotificationService,
		@IRemoteAgentService remoteAgent: IRemoteAgentService,
		@IStorageService storage: IStorageService,
	) {
		super();
		const authority = environment.remoteAuthority;
		if (!authority || !isReviewRemoteAuthority(authority)) return;
		const hosts = reviewWindowHosts(mainProcess.getChannel(REVIEW_DESKTOP_CHANNEL));
		this._register(showSourceWindowHostState(authority.slice("whiteboard+".length), hosts, statusbar, notifications, remoteAgent.getConnection(), () => {
			const title = storage.getObject(REVIEW_SOURCE_TITLE_KEY, StorageScope.WORKSPACE);
			return isReviewSourceTitle(title) ? title.alias : undefined;
		}));
	}
}
