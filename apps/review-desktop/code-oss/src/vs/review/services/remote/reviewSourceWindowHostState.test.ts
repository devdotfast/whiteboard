/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../base/common/event.js";
import type { IMainProcessService } from "../../../platform/ipc/common/mainProcessService.js";
import type { INotification, INotificationService } from "../../../platform/notification/common/notification.js";
import { PersistentConnectionEventType, type PersistentConnectionEvent } from "../../../platform/remote/common/remoteAgentConnection.js";
import type { IStorageService } from "../../../platform/storage/common/storage.js";
import type { IWorkbenchEnvironmentService } from "../../../workbench/services/environment/common/environmentService.js";
import type { IRemoteAgentConnection, IRemoteAgentService } from "../../../workbench/services/remote/common/remoteAgentService.js";
import type { IStatusbarEntry, IStatusbarService } from "../../../workbench/services/statusbar/browser/statusbar.js";
import { ReviewSourceWindowHostState, showSourceWindowHostState } from "./reviewSourceWindowHostState.js";
import type { ReviewWindowHosts } from "./reviewWindowAuthorityResolver.js";

const OFFLINE = "devbox — offline, reconnecting…";

function fakes() {
	const entries: IStatusbarEntry[] = [];
	const shown: INotification[] = [];
	let closed = 0;
	const statusbar = {
		addEntry: (entry: IStatusbarEntry) => {
			entries.push(entry);
			return { update: (next: IStatusbarEntry) => void entries.push(next), dispose: () => {} };
		},
	} as unknown as IStatusbarService;
	const notifications = {
		notify: (notification: INotification) => {
			shown.push(notification);
			return { close: () => void closed++ };
		},
	} as unknown as INotificationService;
	let state = "online";
	const hosts: ReviewWindowHosts = { endpoint: async () => undefined, state: async () => ({ alias: "devbox", state }) };
	const connection = new Emitter<PersistentConnectionEvent>();
	return {
		statusbar,
		notifications,
		hosts,
		connection: { onDidStateChange: connection.event } as unknown as IRemoteAgentConnection,
		fire: (type: PersistentConnectionEventType) => connection.fire({ type } as PersistentConnectionEvent),
		set: (next: string) => void (state = next),
		last: () => entries.at(-1),
		shown,
		closed: () => closed,
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

test("shows the alias while online, the offline state within one poll, and restores it", async () => {
	const f = fakes();
	const watch = showSourceWindowHostState("abc-1", f.hosts, f.statusbar, f.notifications, f.connection, undefined, 5);
	try {
		await tick();
		assert.equal(f.last()?.text, "devbox");
		assert.notEqual(f.last()?.kind, "warning");
		assert.equal(f.shown.length, 0);

		f.set("offline");
		await tick();
		assert.equal(f.last()?.text, OFFLINE);
		assert.equal(f.last()?.kind, "warning");
		assert.deepEqual(f.shown.map((n) => [n.message, n.actions]), [["devbox is offline. The window reconnects when it is back.", undefined]]);

		f.fire(PersistentConnectionEventType.ConnectionLost);
		f.set("online");
		await tick();
		assert.equal(f.last()?.text, OFFLINE, "the window's own connection is still down");
		assert.equal(f.closed(), 0);

		f.fire(PersistentConnectionEventType.ConnectionGain);
		assert.equal(f.last()?.text, "devbox");
		assert.notEqual(f.last()?.kind, "warning");
		assert.equal(f.closed(), 1);

		f.set("unreachable");
		await tick();
		assert.equal(f.last()?.text, OFFLINE);
		assert.equal(f.shown.length, 1, "no second notification in the same window");
	} finally {
		watch.dispose();
	}
});

test("a window on another authority shows nothing and never asks main", () => {
	for (const remoteAuthority of [undefined, "ssh-remote+x", "Whiteboard+ABC"]) {
		const contribution = new ReviewSourceWindowHostState(
			{ remoteAuthority } as IWorkbenchEnvironmentService,
			{ getChannel: () => assert.fail("asked main") } as unknown as IMainProcessService,
			{ addEntry: () => assert.fail("added an entry") } as unknown as IStatusbarService,
			{ notify: () => assert.fail("notified") } as unknown as INotificationService,
			{ getConnection: () => null } as unknown as IRemoteAgentService,
			{ getObject: () => assert.fail("read storage") } as unknown as IStorageService,
		);
		contribution.dispose();
	}
});

test("a window restored before main knows its host's alias names it by the alias it stored when it opened", async () => {
	const f = fakes();
	const contribution = new ReviewSourceWindowHostState(
		{ remoteAuthority: "whiteboard+3f454168-aaaa" } as IWorkbenchEnvironmentService,
		{ getChannel: () => ({ call: async (command: string) => (command === "getRemoteHostState" ? { state: "offline" } : undefined) }) } as unknown as IMainProcessService,
		f.statusbar,
		f.notifications,
		{ getConnection: () => null } as unknown as IRemoteAgentService,
		{ getObject: () => ({ side: "head", title: "Remote source", alias: "wb-test-a" }) } as unknown as IStorageService,
	);
	try {
		await tick();
		assert.equal(f.last()?.text, "wb-test-a — offline, reconnecting…");
		assert.equal(f.shown[0]?.message, "wb-test-a is offline. The window reconnects when it is back.");
	} finally {
		contribution.dispose();
	}
});
