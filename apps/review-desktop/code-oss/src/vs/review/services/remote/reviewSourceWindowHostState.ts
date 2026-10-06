/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toAction } from "../../../base/common/actions.js";
import { Event } from "../../../base/common/event.js";
import { Disposable, DisposableStore, toDisposable, type IDisposable } from "../../../base/common/lifecycle.js";
import Severity from "../../../base/common/severity.js";
import { CommandsRegistry } from "../../../platform/commands/common/commands.js";
import { IMainProcessService } from "../../../platform/ipc/common/mainProcessService.js";
import { INotificationService, type INotificationHandle } from "../../../platform/notification/common/notification.js";
import { PersistentConnectionEventType } from "../../../platform/remote/common/remoteAgentConnection.js";
import type { IWorkbenchContribution } from "../../../workbench/common/contributions.js";
import { IWorkbenchEnvironmentService } from "../../../workbench/services/environment/common/environmentService.js";
import { IRemoteAgentService, type IRemoteAgentConnection } from "../../../workbench/services/remote/common/remoteAgentService.js";
import { IStatusbarService, StatusbarAlignment, type IStatusbarEntry, type IStatusbarEntryAccessor } from "../../../workbench/services/statusbar/browser/statusbar.js";
import { IStorageService, StorageScope } from "../../../platform/storage/common/storage.js";
import { reviewHostStatus, type ReviewGatewayHostState } from "../../common/reviewProtocol.js";
import { REVIEW_DESKTOP_CHANNEL } from "../../common/reviewDesktopBootstrap.js";
import { isReviewSourceTitle, REVIEW_SOURCE_TITLE_KEY } from "../configuration/reviewSourceWindowConfiguration.js";
import { isReviewRemoteAuthority } from "./reviewRemoteAuthority.js";
import { reviewWindowHosts, type ReviewWindowHosts } from "./reviewWindowAuthorityResolver.js";

export const HOST_STATE_POLL_MS = 2_000;

export const RETRY_HOST_COMMAND = "review.sourceWindow.retryHost";

/** Shows a Source window's host as main sees it, with Retry while it is offline. */
export function showSourceWindowHostState(
	serverId: string,
	hosts: ReviewWindowHosts,
	statusbar: IStatusbarService,
	notifications: INotificationService,
	connection: Pick<IRemoteAgentConnection, "onDidStateChange"> | null,
	retry: (alias: string) => void,
	storedAlias: () => string | undefined = () => undefined,
	every = HOST_STATE_POLL_MS,
): IDisposable {
	const store = new DisposableStore();
	let mainAlias: string | undefined;
	let host: Pick<ReviewGatewayHostState, "state" | "detail"> | undefined;
	let lost = false;
	let notified = false;
	let entry: IStatusbarEntryAccessor | undefined;
	let notice: INotificationHandle | undefined;
	const alias = () => mainAlias ?? storedAlias() ?? serverId.slice(0, 8);
	store.add(CommandsRegistry.registerCommand(RETRY_HOST_COMMAND, () => retry(alias())));
	const retryAction = toAction({ id: RETRY_HOST_COMMAND, label: "Retry", run: () => retry(alias()) });
	const render = () => {
		if (!host) return;
		const state = lost && host.state === "online" ? "offline" : host.state;
		const status = reviewHostStatus({ alias: alias(), state, detail: host.detail });
		const offline = state !== "online";
		const canRetry = status.action === "retry";
		const props: IStatusbarEntry = {
			name: "Remote Host",
			text: status.label,
			ariaLabel: status.label,
			tooltip: offline ? status.sentence : undefined,
			kind: offline ? "warning" : undefined,
			command: canRetry ? RETRY_HOST_COMMAND : undefined,
		};
		if (entry) entry.update(props);
		else entry = store.add(statusbar.addEntry(props, "review.sourceWindow.host", StatusbarAlignment.LEFT, Number.MAX_VALUE));
		if (!offline) {
			notified = false;
			notice?.close();
			notice = undefined;
			return;
		}
		const actions = { primary: canRetry ? [retryAction] : [] };
		if (notice) {
			notice.updateMessage(status.sentence);
			notice.updateActions(actions);
		} else if (!notified) {
			notified = true;
			const shown = notifications.notify({ severity: Severity.Warning, message: status.sentence, actions });
			notice = shown;
			Event.once(shown.onDidClose)(() => {
				if (notice === shown) notice = undefined;
			});
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
			host = state;
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
		const channel = mainProcess.getChannel(REVIEW_DESKTOP_CHANNEL);
		const retry = (alias: string) => void channel.call("retryRemoteHost", alias).catch(() => undefined);
		this._register(showSourceWindowHostState(authority.slice("whiteboard+".length), reviewWindowHosts(channel), statusbar, notifications, remoteAgent.getConnection(), retry, () => {
			const title = storage.getObject(REVIEW_SOURCE_TITLE_KEY, StorageScope.WORKSPACE);
			return isReviewSourceTitle(title) ? title.alias : undefined;
		}));
	}
}
