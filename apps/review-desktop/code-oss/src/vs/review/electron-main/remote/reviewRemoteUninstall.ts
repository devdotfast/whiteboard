/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { plainText } from "./reviewRemoteAgents.js";
import { lastLine, runSsh, type SpawnSsh } from "./reviewRemoteHost.js";
import { REVIEW_REMOTE_INSTALL_SAY, remoteInstallScriptInput } from "./reviewRemoteInstallScript.js";
import { sshExecArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export const REVIEW_REMOTE_UNINSTALL_TIMEOUT = 60_000;

/** Runs the newest installed version's own `whiteboard remote uninstall`, keeping reviews. */
export async function uninstallRemote(input: {
	session: ReviewSshSession;
	spawn: SpawnSsh;
	env: NodeJS.ProcessEnv;
	script: string;
	timeout?: number;
}): Promise<void> {
	const { session, spawn, env } = input;
	const timeout = input.timeout ?? REVIEW_REMOTE_UNINSTALL_TIMEOUT;
	const failed = (detail: string) => new Error(`Could not remove Whiteboard from ${session.alias}: ${detail}`);
	const ran = await runSsh(spawn, env, sshExecArgs(session, env), timeout, remoteInstallScriptInput(input.script, ["uninstall"]));
	const refused = ran.stdout
		.split("\n")
		.filter((line) => line.startsWith(`${REVIEW_REMOTE_INSTALL_SAY} FAIL `))
		.at(-1)
		?.slice(REVIEW_REMOTE_INSTALL_SAY.length + 6);
	if (refused) throw failed(`${refused}.`);
	const result = ran.stdout
		.split("\n")
		.map((line) => {
			try {
				return JSON.parse(line) as { event?: unknown; ok?: unknown; reason?: unknown };
			} catch {
				return undefined;
			}
		})
		.filter((value) => value?.event === "remote.uninstall")
		.at(-1);
	if (result?.ok === true) return;
	throw failed(typeof result?.reason === "string" ? plainText(result.reason) : sshProblem(ran));
}

function sshProblem(result: Awaited<ReturnType<typeof runSsh>>): string {
	if (result.timedOut) return "it did not answer in time.";
	if (result.error) return result.error.message;
	const stderr = lastLine(result.stderr);
	return `exit ${result.code}${stderr ? `: ${stderr}` : ""}.`;
}
