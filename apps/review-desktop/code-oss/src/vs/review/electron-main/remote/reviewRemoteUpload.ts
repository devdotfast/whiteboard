/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { runSsh, type SpawnSsh } from "./reviewRemoteHost.js";
import { sshExecArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export const REVIEW_REMOTE_UPLOAD_TIMEOUTS = {
	stall: 30_000,
	flush: 120_000,
	finish: 60_000,
};

export interface ReviewRemoteUploadOptions {
	readonly spawn: SpawnSsh;
	readonly env: NodeJS.ProcessEnv;
	readonly onProgress?: (sent: number, total: number) => void;
	readonly timeouts?: Partial<typeof REVIEW_REMOTE_UPLOAD_TIMEOUTS>;
}

const OK = "WHITEBOARD-UPLOAD-OK";
const MISMATCH = "WHITEBOARD-UPLOAD-MISMATCH";

function checkRemotePath(remotePath: string): void {
	if (!remotePath.startsWith("/") || remotePath.length > 4096 || /['\\\x00-\x1f\x7f-\x9f]/.test(remotePath)) {
		throw new Error(`Whiteboard cannot upload to ${JSON.stringify(remotePath)}: it needs an absolute path without quotes, backslashes or control characters.`);
	}
}

export interface ReviewRemoteUpload {
	readonly sha256: string;
	readonly bytes: number;
}

export async function uploadFile(
	session: ReviewSshSession,
	localPath: string,
	remotePath: string,
	options: ReviewRemoteUploadOptions,
): Promise<ReviewRemoteUpload> {
	checkRemotePath(remotePath);
	const timeouts = { ...REVIEW_REMOTE_UPLOAD_TIMEOUTS, ...options.timeouts };
	const total = (await stat(localPath)).size;
	const where = `The upload of ${localPath} to ${session.alias}:${remotePath}`;
	const sha256 = await send(session, localPath, remotePath, total, options, timeouts, where);

	const script = [
		`f='${remotePath}'`,
		`size=$(wc -c < "$f.part") || exit 3`,
		`sum=$(sha256sum "$f.part") || exit 3`,
		`sum=\${sum%% *}`,
		`if [ $size -eq ${total} ] && [ "$sum" = ${sha256} ]; then mv -f "$f.part" "$f" && echo ${OK}`,
		`else rm -f "$f.part"; echo ${MISMATCH} $size $sum; fi`,
		"",
	].join("\n");
	const result = await runSsh(options.spawn, options.env, sshExecArgs(session, options.env), timeouts.finish, script);
	if (result.stdout.includes(OK)) return { sha256, bytes: total };
	if (result.timedOut) throw new Error(`${where} was not checked within ${timeouts.finish / 1000} seconds.`);
	const mismatch = result.stdout.split("\n").find((line) => line.startsWith(MISMATCH));
	if (mismatch) {
		const [, size, sum] = mismatch.split(" ");
		throw new Error(`${where} does not match what was sent: ${size} bytes with sha256 ${sum}, not ${total} bytes with ${sha256}. It was removed.`);
	}
	throw new Error(`${where} could not be checked: ${result.error?.message ?? `exit ${result.code}: ${result.stderr.trim().split("\n").at(-1) ?? ""}`}`);
}

function send(
	session: ReviewSshSession,
	localPath: string,
	remotePath: string,
	total: number,
	options: ReviewRemoteUploadOptions,
	timeouts: typeof REVIEW_REMOTE_UPLOAD_TIMEOUTS,
	where: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = sshExecArgs(session, options.env, ["sh", "-c", `'cat > "$1.part"'`, "sh", `'${remotePath}'`]);
		let child: ReturnType<SpawnSsh>;
		try {
			child = options.spawn(args, { env: options.env, detached: true, stdio: ["pipe", "ignore", "pipe"] });
		} catch (error) {
			return reject(new Error(`${where} could not start: ${(error as Error).message}`));
		}
		const file = createReadStream(localPath);
		const hash = createHash("sha256");
		const stdin = child.stdin!;
		let sent = 0;
		let stderr = "";
		let failure: string | undefined;
		let stall: ReturnType<typeof setTimeout>;
		const watch = (ms: number, what: string) => {
			clearTimeout(stall);
			stall = setTimeout(() => {
				failure = `stalled: ${what} for ${ms / 1000} seconds`;
				child.kill("SIGKILL");
			}, ms);
		};
		const accepted = () => watch(timeouts.stall, "ssh took nothing from its stdin");
		accepted();

		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(0, 4096)));
		stdin.on("error", () => {});
		file.on("error", (error) => {
			failure = `reading the file failed: ${error.message}`;
			child.kill("SIGKILL");
		});
		file.on("data", (chunk) => {
			hash.update(chunk);
			sent += chunk.length;
			options.onProgress?.(sent, total);
			if (stdin.write(chunk)) return accepted();
			file.pause();
			stdin.once("drain", () => {
				accepted();
				file.resume();
			});
		});
		file.on("end", () => {
			stdin.end();
			watch(timeouts.flush, "ssh did not finish sending what it held");
		});
		child.once("exit", () => {
			file.destroy();
			stdin.destroy();
		});
		child.once("error", (error: Error) => {
			failure ??= `ssh could not start: ${error.message}`;
		});
		child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(stall);
			if (!failure && code === 0 && sent === total) return resolve(hash.digest("hex"));
			const reason = failure ?? (code === 0 ? `the file changed while it was sent (${sent} of ${total} bytes)` : `ssh ${signal ? `was stopped (${signal})` : `exited with ${code}`}${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`);
			reject(new Error(`${where} did not finish after ${sent} of ${total} bytes: ${reason}.`));
		});
	});
}
