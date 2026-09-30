/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * POSIX sh, sent to `sh -s` on the remote. Finds the CLI on PATH, in
 * ~/.local/bin, then through the login shell (Node version managers), and
 * exits 127 when there is none. The CLI's directory goes first on PATH, so
 * a `#!/usr/bin/env node` next to it is found. `groups` are the optional
 * extension groups this Desktop has enabled.
 */
export function reviewRemoteAttachScript(groups: readonly string[] = []): string {
	for (const group of groups) {
		if (!/^[a-z0-9-]+$/.test(group)) throw new Error(`Invalid extension group ${JSON.stringify(group)}.`);
	}
	return `wb=$(command -v whiteboard 2>/dev/null)
case "$wb" in /*) ;; *) wb= ;; esac
if [ -z "$wb" ] && [ -x "$HOME/.local/bin/whiteboard" ]; then wb="$HOME/.local/bin/whiteboard"; fi
if [ -z "$wb" ] && [ -n "$SHELL" ]; then
	wb=$("$SHELL" -lic 'command -v whiteboard' </dev/null 2>/dev/null | tr -d '\\r' | grep '^/.*/whiteboard$' | tail -n 1)
fi
if [ -z "$wb" ] || [ ! -x "$wb" ]; then exit 127; fi
PATH="\${wb%/*}:$PATH"
export PATH
exec "$wb" remote attach --json${groups.length ? ` --groups ${groups.join(",")}` : ""}
`;
}

export const REVIEW_REMOTE_ATTACH_BEGIN = "WHITEBOARD-REMOTE-BEGIN";
export const REVIEW_REMOTE_ATTACH_END = "WHITEBOARD-REMOTE-END";

export interface ReviewRemoteLanguageServer {
	/** The VS Code server's loopback port on the remote. */
	readonly port: number;
	readonly connectionToken: string;
	readonly commit: string;
}

export interface ReviewRemoteAttach {
	readonly version: string | null;
	readonly serverId: string | null;
	readonly token: string;
	/** The remote server's loopback port. */
	readonly port: number;
	readonly languageServer: ReviewRemoteLanguageServer | null;
	/** Why there is no language server. */
	readonly languageServerDetail?: string;
}

/**
 * Reads the one JSON line between the sentinels; everything around them is
 * login noise. The sentinels are searched as substrings, because start-up
 * output without a trailing newline can share their line. `undefined` when
 * there are no sentinels.
 */
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
		return {
			attach: {
				version: typeof record.version === "string" ? record.version : null,
				serverId: typeof record.serverId === "string" ? record.serverId : null,
				token: record.token,
				port,
				...languageServerOf(record),
			},
		};
	}
	return { error: "remote attach printed nothing readable between its sentinels." };
}

function languageServerOf(record: Record<string, unknown>): Pick<ReviewRemoteAttach, "languageServer" | "languageServerDetail"> {
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
	// An older package says nothing of a language server.
	return { languageServer: null, languageServerDetail: detail ?? "The Whiteboard on this host has no VS Code server." };
}

/** Remote data is untrusted: only a port on the remote's loopback is used. */
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
