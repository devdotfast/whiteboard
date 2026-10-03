/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stripVTControlCharacters } from "node:util";
import { REVIEW_REMOTE_AGENT_IDS, type ReviewRemoteAgent, type ReviewRemoteAgentId, type ReviewRemoteAgentResult } from "../../common/reviewProtocol.js";
import { pathCliScript } from "./reviewRemoteAttachScript.js";
import { shellQuote } from "./reviewRemoteInstallScript.js";

/** The installed version's CLI by its paths; without it, the one on PATH (a hand install). */
export type ReviewRemoteCli = { readonly nodePath: string; readonly cliPath: string } | undefined;

/**
 * The login shell's PATH first, where agents' commands live (version managers,
 * ~/.local/bin); only its marked line is read, so start-up output is ignored.
 * The CLI runs as itself: no hand-off to another installed version.
 */
const LOGIN_PATH = `if [ -n "$SHELL" ]; then
	p=$("$SHELL" -lic 'printf "\\nWHITEBOARD-PATH=%s\\n" "$PATH"' </dev/null 2>/dev/null | tr -d '\\r' | sed -n 's/^WHITEBOARD-PATH=//p' | tail -n 1)
	case "$p" in /*) PATH="$p:$PATH"; export PATH ;; esac
fi
DEV_FAST_REVIEW_CLI_NO_DELEGATE=1
export DEV_FAST_REVIEW_CLI_NO_DELEGATE
`;

/** `whiteboard connect <args>` on the remote, for `sh -s`. */
export function remoteConnectScript(cli: ReviewRemoteCli, args: readonly string[]): string {
	const words = ["connect", ...args].map((word) => shellQuote(word)).join(" ");
	return `${LOGIN_PATH}${cli ? `exec ${shellQuote(cli.nodePath)} ${shellQuote(cli.cliPath)} ${words}\n` : pathCliScript(words)}`;
}

/** The remote's words, as plain text: no escape sequences or control characters. */
export const plainText = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim();

const MAX_AGENTS = 16;
const OUTPUT_LIMIT = 1000;

export const isRemoteAgentId = (value: unknown): value is ReviewRemoteAgentId => REVIEW_REMOTE_AGENT_IDS.some((id) => id === value);

/** The last JSON line of `event`; anything around it is login noise. */
function lastEvent(stdout: string, event: string): Record<string, unknown> | undefined {
	for (const line of stdout.split("\n").reverse()) {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (value && typeof value === "object" && (value as Record<string, unknown>).event === event) return value as Record<string, unknown>;
	}
	return undefined;
}

/** Each known agent once, in Desktop's order. Anything else the remote says is dropped; the names are Desktop's own. */
function agentsOf<T extends { id: ReviewRemoteAgentId }>(record: Record<string, unknown> | undefined, read: (item: Record<string, unknown>) => T | undefined): T[] | undefined {
	if (!record || !Array.isArray(record.agents)) return undefined;
	const found = new Map<ReviewRemoteAgentId, T>();
	for (const item of record.agents.slice(0, MAX_AGENTS)) {
		if (!item || typeof item !== "object" || !isRemoteAgentId((item as Record<string, unknown>).id)) continue;
		const agent = read(item as Record<string, unknown>);
		if (agent && !found.has(agent.id)) found.set(agent.id, agent);
	}
	return REVIEW_REMOTE_AGENT_IDS.flatMap((id) => found.get(id) ?? []);
}

/** `connect --detect --json`; undefined when it printed no such line. */
export function parseRemoteAgents(stdout: string): ReviewRemoteAgent[] | undefined {
	return agentsOf(lastEvent(stdout, "connect.detect"), (item) =>
		typeof item.connected === "boolean"
			? { id: item.id as ReviewRemoteAgentId, connected: item.connected, ...(item.manual === true && { manual: true as const }) }
			: undefined,
	);
}

/** `connect --yes --json`; undefined when it printed no such line. */
export function parseRemoteConnect(stdout: string): ReviewRemoteAgentResult[] | undefined {
	return agentsOf(lastEvent(stdout, "connect.run"), (item) =>
		typeof item.connected === "boolean"
			? { id: item.id as ReviewRemoteAgentId, connected: item.connected, output: plainText(typeof item.output === "string" ? item.output : "").slice(-OUTPUT_LIMIT) }
			: undefined,
	);
}
