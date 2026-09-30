/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { Schemas } from "../../../../base/common/network.js";
import type { URI } from "../../../../base/common/uri.js";
import type { IExtensionDescription } from "../../../../platform/extensions/common/extensions.js";
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

/** The extensions this host scanned, for the peers that allow only a host's own contributions. */
export interface IReviewRemoteExtensions {
	readonly _serviceBrand: undefined;
	readonly extensions: readonly IExtensionDescription[];
}
export const IReviewRemoteExtensions = createDecorator<IReviewRemoteExtensions>("reviewRemoteExtensions");

/** A literal prefix, so an entity-encoded or escaped scheme never counts as web. */
const WEB_LINK = /^(https?|mailto):/i;
/** The `](target "title")` half of an inline link, whatever its label. */
const INLINE_TARGET = /\]\(\s*<?([^)\s>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
/** `[ref]: target` reference definitions. */
const REFERENCE = /^[ \t]*\[[^\]\n]+\]:[ \t]*<?(\S*?)>?(?:[ \t].*)?$/gm;
/** `<scheme:...>` autolinks. */
const AUTO_LINK = /<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi;
const LINKS = "links other than http, https and mailto in text a remote shows";

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

	/**
	 * Text a remote wrote that the window renders with links (notifications,
	 * progress, quick input, status bar tooltips). A link the user clicks would
	 * open through the window's opener with commands allowed, so only web and
	 * mail links stay; any other link keeps its label and loses its target.
	 */
	text(value: string): string {
		let stripped = false;
		const strip = (keep: string) => (link: string, target: string) => (WEB_LINK.test(target) ? link : ((stripped = true), keep));
		const result = value
			.replace(INLINE_TARGET, strip("]"))
			.replace(REFERENCE, strip(""))
			.replace(AUTO_LINK, (link: string, target: string) => (WEB_LINK.test(target) ? link : ((stripped = true), target)));
		if (stripped) this.refuse(LINKS);
		return result;
	}

	/** Remote markdown is never trusted: no command links, no HTML. */
	markdown(value: IMarkdownString): IMarkdownString {
		return { ...value, value: this.text(value.value), isTrusted: false, supportHtml: false };
	}

	/** For members whose every call is refused. */
	refuseAll<T>(names: readonly (keyof T)[], kind: string): Partial<T> {
		return Object.fromEntries(names.map((name) => [name, () => { throw this.refuse(kind); }])) as Partial<T>;
	}
}
