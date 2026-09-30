/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeMarkdownSyntaxTokens, type IMarkdownString } from "../../../../base/common/htmlContent.js";
import { parseLinkedText } from "../../../../base/common/linkedText.js";
import * as marked from "../../../../base/common/marked/marked.js";
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

/** A literal prefix, so an entity-encoded, percent-encoded or spaced scheme never counts as web. */
const WEB_LINK = /^(https?|mailto):/i;
const LINKS = "links other than http, https and mailto in text a remote shows";

const WITHHELD = "(message withheld)";
const RESIDUAL = "text with a link the guard could not remove";
/** `NotificationViewItem.MAX_MESSAGE_LENGTH` (private upstream, `workbench/common/notifications.ts`). */
const MAX_MESSAGE_LENGTH = 1000;

/** Link and image targets, and raw HTML if asked, that the window's markdown parser finds and that are not web. */
function markdownLinks(value: string, html = true) {
	const unsafe: marked.Token[] = [];
	marked.walkTokens(marked.lexer(value, { gfm: true }), (token) => {
		if ((html && token.type === "html") || ((token.type === "link" || token.type === "image") && !WEB_LINK.test(token.href))) unsafe.push(token);
	});
	return unsafe;
}

/**
 * The safety net: whether either of the window's parsers still finds a link
 * that is not web. A static so a test can stand in for a parser difference.
 */
function residualLinks(value: string, html: boolean): boolean {
	return parseLinkedText(value).nodes.some((node) => typeof node !== "string" && !WEB_LINK.test(node.href)) || markdownLinks(value, html).length > 0;
}

/**
 * What the notification renderer does to a message before it parses links
 * (`NotificationViewItem.parseNotificationMessage`): cut to its length limit,
 * then newlines to spaces, then trim. Done here first, with every run of
 * whitespace made one space, the renderer's own pass changes nothing, so it
 * parses exactly what the guard parsed.
 */
function normalise(value: string): string {
	const cut = value.length > MAX_MESSAGE_LENGTH ? `${value.substring(0, MAX_MESSAGE_LENGTH - 3)}...` : value;
	return cut.replace(/\s+/g, " ").trim();
}

/** Markdown with every syntax character escaped, `<` and `&` too: no link, image or HTML is left. */
function inert(value: string): string {
	return escapeMarkdownSyntaxTokens(value).replace(/[<>&]/g, "\\$&");
}

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
	 * Text a remote wrote that the window renders with `parseLinkedText`
	 * (notifications, progress, quick input prompts and validation, plain
	 * tooltips). A link the user clicks would open through the window's opener
	 * with commands allowed. So the text is first normalised as the
	 * notification renderer does, then, with that same parser, every link whose
	 * target is not http, https or mailto becomes its label, repeated until the
	 * parser finds none (a label can close a link around it). Finally both of
	 * the window's parsers check the result.
	 */
	text(value: string): string {
		let result = normalise(value);
		for (;;) {
			const nodes = parseLinkedText(result).nodes;
			if (!nodes.some((node) => typeof node !== "string" && !WEB_LINK.test(node.href))) break;
			this.refuse(LINKS);
			result = nodes.map((node) => (typeof node === "string" ? node : WEB_LINK.test(node.href) ? `[${node.label}](${node.href})` : node.label)).join("");
		}
		return this.checked(result, false);
	}

	/** Whatever a parser difference, a non-web link never leaves the guard: the text is withheld instead. */
	private checked(value: string, html: boolean): string {
		if (!ReviewRemoteRefusals.residual(value, html)) return value;
		this.refuse(RESIDUAL);
		return WITHHELD;
	}

	static residual = residualLinks;

	/**
	 * Remote markdown for the window's markdown renderer: rebuilt with only its
	 * text, untrusted, no HTML, and no `uris` or `baseUri` (they would resolve a
	 * web-looking link to any target). With the window's own markdown parser,
	 * every link, image or HTML it would render that is not http, https or
	 * mailto is made inert text; if one survives that, the whole text is.
	 */
	markdown(value: IMarkdownString): IMarkdownString {
		let text = value.value;
		for (let round = 0; round < 8; round++) {
			const unsafe = markdownLinks(text);
			if (!unsafe.length) break;
			this.refuse(LINKS);
			if (!unsafe.every((token) => text.includes(token.raw))) {
				text = inert(text);
				break;
			}
			for (const token of unsafe) text = text.replace(token.raw, inert(token.type === "html" ? token.raw : (token as marked.Tokens.Link).text));
		}
		if (markdownLinks(text).length) text = inert(text);
		return { value: this.checked(text, true), isTrusted: false, supportHtml: false, ...(value.supportThemeIcons !== undefined && { supportThemeIcons: value.supportThemeIcons }) };
	}

	/** For members whose every call is refused. */
	refuseAll<T>(names: readonly (keyof T)[], kind: string): Partial<T> {
		return Object.fromEntries(names.map((name) => [name, () => { throw this.refuse(kind); }])) as Partial<T>;
	}
}
