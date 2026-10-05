/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { Disposable, toDisposable, type IDisposable } from "../../../base/common/lifecycle.js";
import { createSshAskpass, type ReviewSshAskpass } from "./reviewSshAskpass.js";
import {
	prepareSshControlDirectory,
	reviewSshControlDirectory,
	reviewSshSession,
	sshMasterArgs,
} from "./reviewSshCommand.js";
import { reviewSshPromptRelay } from "./reviewSshPromptRelay.js";

export const REVIEW_SSH_DEV_CONNECT_ENV = "DEV_FAST_REVIEW_SSH_CONNECT";

export function startReviewSshDevConnect(log: (message: string) => void, env: NodeJS.ProcessEnv = process.env): IDisposable {
	const aliases = env[REVIEW_SSH_DEV_CONNECT_ENV]?.split(",").filter(Boolean) ?? [];
	if (!env.VSCODE_DEV || !aliases.length) return Disposable.None;

	const children = new Set<ChildProcess>();
	let askpass: ReviewSshAskpass | undefined;
	let disposed = false;
	const stop = () => {
		disposed = true;
		for (const child of children) child.kill();
		askpass?.dispose();
	};
	process.once("exit", stop);

	void (async () => {
		const directory = reviewSshControlDirectory();
		await prepareSshControlDirectory(directory);
		askpass = await createSshAskpass({ directory, prompt: (request) => reviewSshPromptRelay.prompt(request), log });
		if (disposed) return askpass.dispose();
		for (const alias of aliases) {
			const session = reviewSshSession(alias, directory);
			const child = spawn("ssh", sshMasterArgs(session, env), {
				env: { ...env, ...askpass.env(alias) },
				stdio: ["ignore", "ignore", "pipe"],
				detached: true,
			});
			children.add(child);
			child.on("error", (error) => log(`[ssh dev] ${alias}: ${error.message}`));
			let stderr = "";
			child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
			log(`[ssh dev] ${alias}: master started, pid ${child.pid}`);
			let connected = false;
			const poll = setInterval(async () => {
				if (!connected && (await stat(session.controlPath).then((s) => s.isSocket(), () => false))) {
					connected = true;
					clearInterval(poll);
					log(`[ssh dev] ${alias}: connected, control socket ${session.controlPath}`);
				}
			}, 200);
			child.on("exit", (code, signal) => {
				clearInterval(poll);
				children.delete(child);
				log(`[ssh dev] ${alias}: ssh exited ${code ?? signal}; stderr: ${stderr.trim() || "(none)"}`);
			});
		}
	})().catch((error: Error) => log(`[ssh dev] ${error.message}`));

	return toDisposable(() => {
		process.off("exit", stop);
		stop();
	});
}
