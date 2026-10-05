/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { REVIEW_REMOTE_ATTACH_BEGIN, REVIEW_REMOTE_ATTACH_END } from "../../common/reviewProtocol.js";
import { shellQuote } from "./reviewRemoteInstallScript.js";

export function pathCliScript(words: string): string {
	return `wb=$(command -v whiteboard 2>/dev/null)
case "$wb" in /*) ;; *) wb= ;; esac
if [ -z "$wb" ] && [ -x "$HOME/.local/bin/whiteboard" ]; then wb="$HOME/.local/bin/whiteboard"; fi
if [ -z "$wb" ] && [ -n "$SHELL" ]; then
	wb=$("$SHELL" -lic 'command -v whiteboard' </dev/null 2>/dev/null | tr -d '\\r' | grep '^/.*/whiteboard$' | tail -n 1)
fi
if [ -z "$wb" ] || [ ! -x "$wb" ]; then exit 127; fi
PATH="\${wb%/*}:$PATH"
export PATH
exec "$wb" ${words}
`;
}

export function reviewRemoteAttachScript(groups: readonly string[] = []): string {
	for (const group of groups) {
		if (!/^[a-z0-9-]+$/.test(group)) throw new Error(`Invalid extension group ${JSON.stringify(group)}.`);
	}
	return pathCliScript(`remote attach --json${groups.length ? ` --groups ${groups.join(",")}` : ""}`);
}

export function installedAttachScript(nodePath: string, cliPath: string): string {
	return `exec ${shellQuote(nodePath)} ${shellQuote(cliPath)} remote attach --json --replace\n`;
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
		const port = loopbackPort(record.url);
		if (port === undefined || typeof record.token !== "string" || !record.token) {
			return { error: "remote attach answered without a loopback URL and a token." };
		}
		const running = record.incompatibleRunning as Record<string, unknown> | undefined;
		return {
			attach: {
				version: typeof record.version === "string" ? record.version : null,
				serverId: typeof record.serverId === "string" && UUID.test(record.serverId) ? record.serverId : null,
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
	const detail = typeof record.languageServerDetail === "string" ? record.languageServerDetail.slice(0, 2000) : undefined;
	const server = record.languageServer as Record<string, unknown> | null | undefined;
	if (server && typeof server === "object") {
		const { port, connectionToken, commit } = server;
		if (
			typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536 &&
			typeof connectionToken === "string" && /^[0-9A-Za-z_-]+$/.test(connectionToken) &&
			typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit)
		) {
			return { languageServer: { port, connectionToken, commit } };
		}
		return { languageServer: null, languageServerDetail: "remote attach reported a VS Code server without a port, a token and a commit." };
	}
	return {
		languageServer: null,
		languageServerDetail: detail ?? "The Whiteboard on this host has no VS Code server.",
		...(record.languageServerPending === true && { languageServerPending: true as const }),
	};
}

function languageGroupsOf(value: unknown): ReviewRemoteLanguageGroup[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, 16).flatMap((entry: unknown) => {
		const { group, installed, detail } = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
		if (typeof group !== "string" || !/^[a-z0-9-]{1,40}$/.test(group) || typeof installed !== "boolean") return [];
		return [{ group, installed, ...(typeof detail === "string" && detail && { detail: detail.slice(0, 500) }) }];
	});
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const versionText = (value: unknown) => (typeof value === "string" && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(value) ? value : "unknown");

function loopbackPort(url: unknown): number | undefined {
	if (typeof url !== "string") return undefined;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) return undefined;
		const port = Number(parsed.port);
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
	} catch {
		return undefined;
	}
}
