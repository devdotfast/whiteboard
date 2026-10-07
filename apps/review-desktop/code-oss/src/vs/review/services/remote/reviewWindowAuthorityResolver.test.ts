/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../base/common/uri.js";
import type { IChannel } from "../../../base/parts/ipc/common/ipc.js";
import {
	type IRemoteAuthorityResolverService,
	RemoteAuthorityResolverError,
	RemoteAuthorityResolverErrorCode,
	RemoteConnectionType,
	type ResolverResult,
} from "../../../platform/remote/common/remoteAuthorityResolver.js";
import type { ReviewGatewayHostState } from "../../common/reviewProtocol.js";
import { remoteHostState } from "../../electron-main/remote/reviewRemoteHosts.js";
import { reloadWhenOnline, reviewWindowAuthorityResolver, reviewWindowHosts, type ReviewWindowHosts } from "./reviewWindowAuthorityResolver.js";

const AUTHORITY = "whiteboard+abc-1";

/** Main's answers, in order; the last one repeats. */
function fakeChannel(answers: { endpoint?: { host: string; port: number; connectionToken: string }; state?: { alias: string; state: string } }[]) {
	const calls: [string, unknown][] = [];
	let index = 0;
	const channel = {
		call: async (command: string, arg: unknown) => {
			calls.push([command, arg]);
			const answer = answers[Math.min(index, answers.length - 1)];
			if (command === "getRemoteLanguageEndpoint") return answer.endpoint;
			index++;
			return answer.state;
		},
		listen: () => {
			throw new Error("not used");
		},
	} as unknown as IChannel;
	return { channel, calls };
}

/**
 * Main as it behaves: each phase is what the gateway lists and which alias in
 * the setting served the machine; the state goes through main's own lookup.
 */
function fakeMain(phases: { endpoint?: number; states: ReviewGatewayHostState[]; configured?: string }[]) {
	let index = 0;
	const phase = () => phases[Math.min(index, phases.length - 1)];
	const hosts: ReviewWindowHosts = {
		endpoint: async () => {
			const port = phase().endpoint;
			return port === undefined ? undefined : endpoint(port);
		},
		state: async (serverId) => {
			const { states, configured } = phase();
			index++;
			return remoteHostState(serverId, states, configured);
		},
	};
	return { hosts, next: (...more: typeof phases) => phases.splice(0, phases.length, ...more) };
}

function fakeBase() {
	let provider: ((uri: URI) => Promise<URI>) | undefined;
	const base = {
		resolveAuthority: async (authority: string): Promise<ResolverResult> => ({
			authority: { authority, connectTo: { type: RemoteConnectionType.WebSocket, host: "base", port: 1 }, connectionToken: undefined },
		}),
		_setCanonicalURIProvider: (next: (uri: URI) => Promise<URI>) => (provider = next),
		getCanonicalURI: (uri: URI) => provider!(uri),
	} as unknown as IRemoteAuthorityResolverService;
	return base;
}

const endpoint = (port: number) => ({ host: "127.0.0.1", port, connectionToken: "vscode-token" });
const connectTo = (result: ResolverResult) => {
	const { connectTo, connectionToken } = result.authority;
	assert.equal(connectTo.type, RemoteConnectionType.WebSocket);
	return { host: connectTo.host, port: connectTo.port, connectionToken };
};

test("a whiteboard+ authority resolves to its host's forward, afresh each time", async () => {
	const { channel, calls } = fakeChannel([{ endpoint: endpoint(41000) }]);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), reviewWindowHosts(channel));

	assert.deepEqual(connectTo(await resolver.resolveAuthority(AUTHORITY)), { host: "127.0.0.1", port: 41000, connectionToken: "vscode-token" });
	assert.deepEqual(calls, [["getRemoteLanguageEndpoint", "abc-1"]]);
});

test("a resolved authority waits through offline and unreachable for the moved forward", async () => {
	const online = { alias: "devbox", serverId: "abc-1", state: "online" as const };
	const { hosts, next } = fakeMain([{ endpoint: 41000, states: [online], configured: "devbox" }]);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), hosts, { wait: 20, poll: 5 });
	assert.equal(connectTo(await resolver.resolveAuthority(AUTHORITY)).port, 41000);

	// The gateway keeps the id while offline and drops it with Desktop's problem report; each phase outlasts the wait.
	const offline = Array.from({ length: 6 }, () => ({ states: [{ ...online, state: "offline" as const }], configured: "devbox" }));
	const unreachable = Array.from({ length: 6 }, () => ({ states: [{ alias: "devbox", state: "unreachable" as const }], configured: "devbox" }));
	next(...offline, ...unreachable, { endpoint: 42000, states: [online], configured: "devbox" });
	assert.equal(connectTo(await resolver.resolveAuthority(AUTHORITY)).port, 42000);
});

test("a resolved authority whose alias left the setting fails after the wait", async () => {
	const { hosts, next } = fakeMain([{ endpoint: 41000, states: [{ alias: "devbox", serverId: "abc-1", state: "online" }], configured: "devbox" }]);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), hosts, { wait: 20, poll: 5 });
	await resolver.resolveAuthority(AUTHORITY);

	next({ states: [{ alias: "devbox", state: "unreachable" }] });
	const started = Date.now();
	await assert.rejects(resolver.resolveAuthority(AUTHORITY), (error: RemoteAuthorityResolverError) => error._code === RemoteAuthorityResolverErrorCode.NotAvailable);
	assert.ok(Date.now() - started >= 20);
});

test("a resolved authority whose machine is gone after the wait fails; one still known keeps waiting", async () => {
	const answers: Parameters<typeof fakeChannel>[0] = [{ endpoint: endpoint(41000) }];
	const { channel } = fakeChannel(answers);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), reviewWindowHosts(channel), { wait: 20, poll: 5 });
	await resolver.resolveAuthority(AUTHORITY);

	answers.splice(0, 1, {});
	await assert.rejects(resolver.resolveAuthority(AUTHORITY), (error: RemoteAuthorityResolverError) => error._code === RemoteAuthorityResolverErrorCode.NotAvailable);

	answers.splice(0, 1, ...Array.from({ length: 10 }, () => ({ state: { alias: "devbox", state: "offline" } })), { endpoint: endpoint(43000) });
	assert.equal(connectTo(await resolver.resolveAuthority(AUTHORITY)).port, 43000);
});

test("a connecting host is waited for, and resolves once its forward appears", async () => {
	const connecting = { state: { alias: "devbox", state: "connecting" } };
	const { channel } = fakeChannel([connecting, connecting, { endpoint: endpoint(43000) }]);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), reviewWindowHosts(channel), { wait: 1_000, poll: 1 });

	assert.equal(connectTo(await resolver.resolveAuthority(AUTHORITY)).port, 43000);
});

test("before the host list exists, a window waits rather than calling its host offline", async () => {
	const { channel } = fakeChannel([{}, {}, { endpoint: endpoint(44000) }]);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), reviewWindowHosts(channel), { wait: 1_000, poll: 1 });

	assert.equal(connectTo(await resolver.resolveAuthority(AUTHORITY)).port, 44000);
});

test("a host still connecting after the wait, or not connecting at all, is offline", async () => {
	for (const [state, wait] of [["connecting", 20], ["offline", 60_000]] as const) {
		const { channel } = fakeChannel([{ state: { alias: "devbox", state } }]);
		const resolver = reviewWindowAuthorityResolver(fakeBase(), reviewWindowHosts(channel), { wait, poll: 5 });
		const started = Date.now();

		await assert.rejects(resolver.resolveAuthority(AUTHORITY), (error: RemoteAuthorityResolverError) => {
			assert.ok(error instanceof RemoteAuthorityResolverError);
			assert.equal(error._code, RemoteAuthorityResolverErrorCode.NotAvailable);
			assert.equal(error._detail, "devbox is offline");
			return true;
		});
		assert.ok(Date.now() - started < 1_000);
	}
});

test("canonical URIs of whiteboard+ are themselves; every other authority is the window's", async () => {
	const { channel, calls } = fakeChannel([{ endpoint: endpoint(41000) }]);
	const resolver = reviewWindowAuthorityResolver(fakeBase(), reviewWindowHosts(channel));
	resolver._setCanonicalURIProvider(async () => {
		throw new Error("no resolver extension");
	});

	const own = URI.parse(`vscode-remote://${AUTHORITY}/home/dev/repo/f.ts`);
	assert.equal(await resolver.getCanonicalURI(own), own);
	await assert.rejects(resolver.getCanonicalURI(URI.parse("vscode-remote://ssh-remote+x/f.ts")), /no resolver extension/);

	for (const other of ["ssh-remote+x", "Whiteboard+ABC", "whiteboard+a/b"]) {
		assert.equal(connectTo(await resolver.resolveAuthority(other)).host, "base");
	}
	assert.deepEqual(calls, []);
});

test("a window that could not reach its host reloads once, when the host's forward answers", async () => {
	let polls = 0;
	const hosts: ReviewWindowHosts = { endpoint: async () => (++polls >= 3 ? endpoint(45000) : undefined), state: async () => undefined };
	let reloads = 0;
	const watch = reloadWhenOnline(hosts, "abc-1", () => reloads++, 2);

	await new Promise((resolve) => setTimeout(resolve, 60));
	watch.dispose();
	assert.equal(reloads, 1);
	assert.equal(polls, 3);
});
