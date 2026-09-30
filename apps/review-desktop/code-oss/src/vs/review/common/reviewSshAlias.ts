/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/** An alias reaches `ssh` as an argument and a remote shell as a word, so only plain ones pass. */
export function validateSshAlias(alias: string): { ok: true } | { ok: false; reason: string } {
	if (!alias) return { ok: false, reason: "is empty" };
	if (alias.startsWith("-")) return { ok: false, reason: "starts with -" };
	if (/\s/.test(alias)) return { ok: false, reason: "contains whitespace" };
	if (/[\x00-\x1f\x7f-\x9f]/.test(alias)) return { ok: false, reason: "contains a control character" };
	const meta = /[`$;|&<>()'"\\]/.exec(alias);
	if (meta) return { ok: false, reason: `contains ${meta[0]}` };
	return { ok: true };
}

/** `review.remote.hosts` as main and the Settings page read it: anything else is no hosts. */
export function remoteHostAliases(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((alias): alias is string => typeof alias === "string") : [];
}
