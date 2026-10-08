/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from "../../../base/common/async.js";
import { toDisposable, type IDisposable } from "../../../base/common/lifecycle.js";
import type { IChannel } from "../../../base/parts/ipc/common/ipc.js";
import {
	type IRemoteAuthorityResolverService,
	RemoteAuthorityResolverError,
	RemoteAuthorityResolverErrorCode,
	type ResolverResult,
	WebSocketRemoteConnection,
} from "../../../platform/remote/common/remoteAuthorityResolver.js";
import type { ReviewRemoteLanguageEndpoint } from "../reviewDesktopConnectionService.js";
import { isReviewRemoteAuthority, override } from "./reviewRemoteAuthority.js";

/** How long a Source window waits for its host to finish connecting. */
export const REMOTE_WINDOW_RESOLVE_WAIT_MS = 60_000;

export interface ReviewWindowHosts {
	endpoint(serverId: string): Promise<ReviewRemoteLanguageEndpoint | undefined>;
	state(serverId: string): Promise<{ alias?: string; state: string } | undefined>;
}

export function parseRemoteLanguageEndpoint(endpoint: unknown): ReviewRemoteLanguageEndpoint | undefined {
	if (typeof endpoint !== "object" || endpoint === null) return undefined;
	const { host, port, connectionToken } = endpoint as Record<string, unknown>;
	return typeof host === "string" && Number.isInteger(port) && typeof connectionToken === "string"
		? { host, port: port as number, connectionToken }
		: undefined;
}

/** Reloads a window that could not reach its host, once the host's forward answers. */
export function reloadWhenOnline(hosts: ReviewWindowHosts, serverId: string, reload: () => void, every = 5_000): IDisposable {
	let done = false;
	const check = async () => {
		const endpoint = await hosts.endpoint(serverId).catch(() => undefined);
		if (!endpoint || done) return;
		done = true;
		clearInterval(handle);
		reload();
	};
	const handle = setInterval(() => void check(), every);
	return toDisposable(() => {
		done = true;
		clearInterval(handle);
	});
}

export function reviewWindowHosts(channel: IChannel): ReviewWindowHosts {
	return {
		endpoint: async (serverId) => parseRemoteLanguageEndpoint(await channel.call("getRemoteLanguageEndpoint", serverId)),
		state: async (serverId) => {
			const state: unknown = await channel.call("getRemoteHostState", serverId);
			if (typeof state !== "object" || state === null) return undefined;
			const { alias, state: name } = state as Record<string, unknown>;
			return typeof name === "string" ? { alias: typeof alias === "string" ? alias : undefined, state: name } : undefined;
		},
	};
}

/** Resolves `whiteboard+<serverId>` to the host's current forward; other authorities go to `base`. */
export function reviewWindowAuthorityResolver(
	base: IRemoteAuthorityResolverService,
	hosts: ReviewWindowHosts,
	{ wait = REMOTE_WINDOW_RESOLVE_WAIT_MS, poll = 1_000 } = {},
): IRemoteAuthorityResolverService {
	const resolved = new Set<string>();
	const resolve = async (authority: string): Promise<ResolverResult> => {
		const serverId = authority.slice("whiteboard+".length);
		const again = resolved.has(authority);
		const deadline = Date.now() + wait;
		for (;;) {
			const endpoint = await hosts.endpoint(serverId);
			if (endpoint) {
				resolved.add(authority);
				const { host, port, connectionToken } = endpoint;
				return { authority: { authority, connectTo: new WebSocketRemoteConnection(host, port), connectionToken }, options: {} };
			}
			const state = await hosts.state(serverId);
			const left = deadline - Date.now();
			// A moved forward passes through offline or unreachable; only a machine gone from the setting ends a reconnect.
			const waiting = again ? state !== undefined || left > 0 : (state === undefined || state.state === "connecting") && left > 0;
			if (!waiting) {
				const offline = `${state?.alias ?? serverId.slice(0, 8)} is offline`;
				throw new RemoteAuthorityResolverError(offline, RemoteAuthorityResolverErrorCode.NotAvailable, offline);
			}
			await timeout(left > 0 ? Math.min(poll, left) : poll);
		}
	};
	return override(base, {
		resolveAuthority: (authority) => (isReviewRemoteAuthority(authority) ? resolve(authority) : base.resolveAuthority(authority)),
		_setCanonicalURIProvider: (provider) =>
			base._setCanonicalURIProvider((uri) => (isReviewRemoteAuthority(uri.authority) ? Promise.resolve(uri) : provider(uri))),
	});
}
