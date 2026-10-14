/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { REVIEW_REMOTE_ATTACH_BEGIN, REVIEW_REMOTE_ATTACH_END } from "../../common/reviewProtocol.js";
import { shellQuote } from "./reviewRemoteInstallScript.js";

export const REVIEW_REMOTE_FIND_CLI = `bounded() {
	if timeout -k 1 1 true >/dev/null 2>&1; then timeout -k 1 "$@"; else shift; "$@"; fi
}
wb=$(command -v whiteboard 2>/dev/null)
case "$wb" in /*) ;; *) wb= ;; esac
if [ -z "$wb" ] && [ -x "$HOME/.local/bin/whiteboard" ]; then wb="$HOME/.local/bin/whiteboard"; fi
if [ -z "$wb" ] && [ -n "$SHELL" ]; then
	wb=$(bounded 3 "$SHELL" -lic 'command -v whiteboard' </dev/null 2>/dev/null | tr -d '\\r' | grep '^/.*/whiteboard$' | tail -n 1)
fi
[ -n "$wb" ] && [ -x "$wb" ] || wb=
`;

export function pathCliScript(words: string): string {
	return `${REVIEW_REMOTE_FIND_CLI}if [ -z "$wb" ]; then exit 127; fi
PATH="\${wb%/*}:$PATH"
export PATH
exec "$wb" ${words}
`;
}

function attachWords(groups: readonly string[], replace: boolean): string {
	return `remote attach --json${replace ? " --replace" : ""}${groups.length ? ` --groups ${groups.join(",")}` : ""}`;
}

export function reviewRemoteAttachScript(groups: readonly string[] = [], replace = false): string {
	return pathCliScript(attachWords(groups, replace));
}

export function installedAttachScript(nodePath: string, cliPath: string, groups: readonly string[] = []): string {
	return `exec ${shellQuote(nodePath)} ${shellQuote(cliPath)} ${attachWords(groups, true)}\n`;
}

export interface ReviewRemoteLanguageServer {
	readonly port: number;
	readonly connectionToken: string;
	readonly commit: string;
}

export interface ReviewRemoteLanguageGroup {
	readonly group: string;
	readonly installed: boolean;
	readonly detail?: string;
}

export interface ReviewRemoteAttach {
	readonly version: string | null;
	readonly serverId: string | null;
	readonly token: string;
	readonly port: number;
	readonly languageServer: ReviewRemoteLanguageServer | null;
	readonly languageServerDetail?: string;
	readonly languageServerPending?: true;
	readonly languageGroups: readonly ReviewRemoteLanguageGroup[];
	readonly replaced?: string;
	readonly incompatibleRunning?: { readonly version: string; readonly startedBy: "user" | "cli" | "desktop" };
}

export function parseRemoteAttach(stdout: string): { attach: ReviewRemoteAttach } | { error: string } | undefined {
	const begin = stdout.indexOf(REVIEW_REMOTE_ATTACH_BEGIN);
	if (begin < 0) return undefined;
	const from = begin + REVIEW_REMOTE_ATTACH_BEGIN.length;
	const end = stdout.indexOf(REVIEW_REMOTE_ATTACH_END, from);
	if (end < 0) return undefined;
	for (const line of stdout.slice(from, end).split("\n")) {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (!value || typeof value !== "object") continue;
		const record = value as Record<string, unknown>;
		if (record.event === "error") {
			const error = record.error as Record<string, unknown> | undefined;
			return { error: typeof error?.message === "string" ? error.message : "remote attach failed." };
		}
		if (record.event !== "remote.attach") continue;
		const port = urlPort(record.url);
		if (port === undefined || typeof record.token !== "string" || !record.token) {
			return { error: "remote attach answered without a URL and a token." };
		}
		const running = record.incompatibleRunning as Record<string, unknown> | undefined;
		return {
			attach: {
				version: typeof record.version === "string" ? record.version : null,
				serverId: typeof record.serverId === "string" ? record.serverId : null,
				token: record.token,
				port,
				...languageServerOf(record),
				languageGroups: languageGroupsOf(record.languageGroups),
				...(record.replaced === true && { replaced: versionText(record.previousVersion) }),
				...(running &&
					typeof running === "object" && {
						incompatibleRunning: { version: versionText(running.version), startedBy: running.startedBy === "cli" || running.startedBy === "desktop" ? running.startedBy : "user" },
					}),
			},
		};
	}
	return { error: "remote attach printed nothing readable between its sentinels." };
}

function languageServerOf(record: Record<string, unknown>): Pick<ReviewRemoteAttach, "languageServer" | "languageServerDetail" | "languageServerPending"> {
	const { port, connectionToken, commit } = (record.languageServer ?? {}) as Record<string, unknown>;
	if (typeof port === "number" && typeof connectionToken === "string" && typeof commit === "string") {
		return { languageServer: { port, connectionToken, commit } };
	}
	return {
		languageServer: null,
		languageServerDetail: typeof record.languageServerDetail === "string" ? record.languageServerDetail : "The Whiteboard on this host has no language server.",
		...(record.languageServerPending === true && { languageServerPending: true as const }),
	};
}

function languageGroupsOf(value: unknown): ReviewRemoteLanguageGroup[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry: unknown) => {
		const { group, installed, detail } = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
		if (typeof group !== "string" || typeof installed !== "boolean") return [];
		return [{ group, installed, ...(typeof detail === "string" && detail && { detail }) }];
	});
}

const versionText = (value: unknown) => (typeof value === "string" ? value : "unknown");

function urlPort(url: unknown): number | undefined {
	if (typeof url !== "string") return undefined;
	try {
		const port = Number(new URL(url).port);
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
	} catch {
		return undefined;
	}
}
