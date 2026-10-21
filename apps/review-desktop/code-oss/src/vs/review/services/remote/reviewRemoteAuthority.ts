/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IDisposable, toDisposable } from "../../../base/common/lifecycle.js";
import { Schemas } from "../../../base/common/network.js";
import type { OperatingSystem } from "../../../base/common/platform.js";
import type { URI } from "../../../base/common/uri.js";

const PREFIX = "whiteboard+";

export function reviewRemoteAuthority(serverId: string): string | undefined {
	return /^[0-9a-z-]+$/i.test(serverId) ? `${PREFIX}${serverId.toLowerCase()}` : undefined;
}

/** The server id in a `reviewRemoteAuthority`. */
export function reviewRemoteServerId(authority: string): string {
	return authority.slice(PREFIX.length);
}

export function ownsRemoteResource(authority: string, resource: URI): boolean {
	return resource.scheme === Schemas.vscodeRemote && resource.authority.toLowerCase() === authority;
}

const remoteOS = new Map<string, OperatingSystem>();

export function setReviewRemoteOS(authority: string, os: OperatingSystem): IDisposable {
	remoteOS.set(authority, os);
	return toDisposable(() => remoteOS.delete(authority));
}

export function reviewRemoteOS(resource: URI): OperatingSystem | undefined {
	return resource.scheme === Schemas.vscodeRemote ? remoteOS.get(resource.authority.toLowerCase()) : undefined;
}

/** Exactly the lower-case `whiteboard+<serverId>` that `reviewRemoteAuthority` makes. */
export function isReviewRemoteAuthority(authority: string | null | undefined): authority is string {
	return !!authority && /^whiteboard\+[0-9a-z-]+$/.test(authority);
}

export function override<T extends object>(base: T, members: Partial<T>): T {
	return new Proxy(base, {
		get(target, key) {
			if (key in members) return (members as Record<PropertyKey, unknown>)[key];
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
