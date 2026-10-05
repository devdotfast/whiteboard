/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runSsh, type SpawnSsh } from "./reviewRemoteHost.js";
import { compareVersions, REVIEW_REMOTE_VERSION } from "./reviewRemoteInstaller.js";
import { REVIEW_REMOTE_INSTALL_MARKER, REVIEW_REMOTE_INSTALL_SAY, shellQuote } from "./reviewRemoteInstallScript.js";
import { sshExecArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export const REVIEW_REMOTE_UNINSTALL_TIMEOUT = 60_000;

const LIST = `root="$HOME/.dev/whiteboard-remote"
for d in "$root"/versions/*; do
	[ -f "$d/${REVIEW_REMOTE_INSTALL_MARKER}" ] && printf '%s HAVE %s\\n' ${REVIEW_REMOTE_INSTALL_SAY} "\${d##*/}"
done
printf '%s LISTED\\n' ${REVIEW_REMOTE_INSTALL_SAY}
`;

function uninstallScript(version: string): string {
	return `m="$HOME/.dev/whiteboard-remote/versions/"${shellQuote(version)}"/${REVIEW_REMOTE_INSTALL_MARKER}"
node=$(sed -n 's/.*"node":"\\([^"]*\\)".*/\\1/p' "$m")
cli=$(sed -n 's/.*"cli":"\\([^"]*\\)".*/\\1/p' "$m")
DEV_FAST_REVIEW_CLI_NO_DELEGATE=1 "$node" "$cli" remote uninstall --keep-reviews --json </dev/null
`;
}

export async function uninstallRemote(input: {
	session: ReviewSshSession;
	spawn: SpawnSsh;
	env: NodeJS.ProcessEnv;
	timeout?: number;
}): Promise<void> {
	const { session, spawn, env } = input;
	const timeout = input.timeout ?? REVIEW_REMOTE_UNINSTALL_TIMEOUT;
	const failed = (detail: string) => new Error(`Could not remove Whiteboard from ${session.alias}: ${detail}`);

	const listed = await runSsh(spawn, env, sshExecArgs(session, env), timeout, LIST);
	const said = (word: string) =>
		listed.stdout
			.split("\n")
			.filter((line) => line.startsWith(`${REVIEW_REMOTE_INSTALL_SAY} ${word}`))
			.map((line) => line.slice(REVIEW_REMOTE_INSTALL_SAY.length + word.length + 2).trim());
	if (!said("LISTED").length) throw failed(sshProblem(listed));
	const newest = said("HAVE")
		.filter((name) => REVIEW_REMOTE_VERSION.test(name))
		.sort(compareVersions)
		.at(-1);
	if (!newest) throw failed("Whiteboard Desktop installed nothing there.");

	const ran = await runSsh(spawn, env, sshExecArgs(session, env), timeout, uninstallScript(newest));
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
	throw failed(typeof result?.reason === "string" ? result.reason.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").slice(0, 300) : sshProblem(ran));
}

function sshProblem(result: Awaited<ReturnType<typeof runSsh>>): string {
	if (result.timedOut) return "it did not answer in time.";
	if (result.error) return result.error.message;
	const stderr = result.stderr.trim().split("\n").at(-1)?.slice(0, 300);
	return `exit ${result.code}${stderr ? `: ${stderr}` : ""}.`;
}
