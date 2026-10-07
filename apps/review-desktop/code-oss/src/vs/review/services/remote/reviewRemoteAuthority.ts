/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from "../../../base/common/network.js";
import type { URI } from "../../../base/common/uri.js";

export function reviewRemoteAuthority(serverId: string): string | undefined {
	return /^[0-9a-z-]+$/i.test(serverId) ? `whiteboard+${serverId.toLowerCase()}` : undefined;
}

export function ownsRemoteResource(authority: string, resource: URI): boolean {
	return resource.scheme === Schemas.vscodeRemote && resource.authority.toLowerCase() === authority;
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
