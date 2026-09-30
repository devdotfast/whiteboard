/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from "../../../../base/common/network.js";
import type { URI } from "../../../../base/common/uri.js";
import { createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import type { ILogService } from "../../../../platform/log/common/log.js";

export function ownsRemoteResource(authority: string, resource: URI): boolean {
	return resource.scheme === Schemas.vscodeRemote && resource.authority.toLowerCase() === authority;
}

/** The window's service with some members replaced; the rest are the window's own. */
export function override<T extends object>(base: T, members: Partial<T>): T {
	return new Proxy(base, {
		get(target, key) {
			if (key in members) return (members as Record<PropertyKey, unknown>)[key];
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export const IReviewRemoteRefusals = createDecorator<ReviewRemoteRefusals>("reviewRemoteRefusals");

/**
 * What a remote's extensions may not do on the laptop. Each refusal is an
 * error the extension receives; each kind is logged once per host.
 */
export class ReviewRemoteRefusals {
	declare readonly _serviceBrand: undefined;
	private readonly logged = new Set<string>();

	constructor(
		readonly authority: string,
		/** The alias, once known. */
		private readonly name: () => string,
		private readonly logService: ILogService,
	) { }

	owns(resource: URI): boolean {
		return ownsRemoteResource(this.authority, resource);
	}

	/** `kind` is a fixed phrase, never a value from the remote, so the set stays small. */
	refuse(kind: string, detail?: string): Error {
		if (!this.logged.has(kind)) {
			this.logged.add(kind);
			this.logService.warn(`[Remote guard] ${this.authority}: refused ${kind}`);
		}
		return new Error(`Not available for an extension on ${this.name()}: ${kind}${detail ? ` (${detail})` : ""}.`);
	}

	/** For members whose every call is refused. */
	refuseAll<T>(names: readonly (keyof T)[], kind: string): Partial<T> {
		return Object.fromEntries(names.map((name) => [name, () => { throw this.refuse(kind); }])) as Partial<T>;
	}
}
