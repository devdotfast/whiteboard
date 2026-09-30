/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { rmSync } from "node:fs";
import { chmod, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { FileAccess } from "../../../base/common/network.js";
import {
	REVIEW_SSH_ASKPASS_ALIAS_ENV,
	REVIEW_SSH_ASKPASS_SOCKET_ENV,
	sshPromptKind,
	type SshPromptKind,
} from "../../common/reviewSshPrompt.js";
import { validateSshAlias } from "./reviewSshCommand.js";

export interface SshPromptRequest {
	readonly alias: string;
	readonly text: string;
	readonly kind: SshPromptKind;
	/** Aborts when ssh stops waiting for the answer. */
	readonly signal?: AbortSignal;
}

export interface ReviewSshAskpass {
	/** For the `ssh` of one alias: SSH_ASKPASS, SSH_ASKPASS_REQUIRE=force, DISPLAY, the socket path and the alias. */
	env(alias: string): Record<string, string>;
	dispose(): void;
}

const MAX_REQUEST_BYTES = 64 * 1024;

/** `ssh` runs the script; it runs Electron as Node on the compiled helper. */
function defaultHelper(): string[] {
	return [process.execPath, FileAccess.asFileUri("vs/review/node/reviewSshAskpassMain.js").fsPath];
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Listens in the 0700 control directory for the askpass helper and asks
 * `prompt` one request at a time. An answer only travels from `prompt` to the
 * helper's socket: it is never logged, stored, or put in an argument or the
 * environment.
 */
export async function createSshAskpass(input: {
	directory: string;
	prompt(request: SshPromptRequest): Promise<string | undefined>;
	log?: (message: string) => void;
	/** The command, before the prompt argument, the script runs. */
	helper?: readonly string[];
}): Promise<ReviewSshAskpass> {
	const log = input.log ?? (() => {});
	const name = `askpass-${process.pid}`;
	const scriptPath = join(input.directory, name);
	const socketPath = join(input.directory, `${name}.sock`);

	await rm(scriptPath, { force: true });
	await writeFile(
		scriptPath,
		`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${(input.helper ?? defaultHelper()).map(shellQuote).join(" ")} "$@"\n`,
		{ mode: 0o700, flag: "wx" },
	);

	// ssh sends a cancelled password as empty and asks again with the same text; those retries are not shown.
	const cancelled = new Map<number, Set<string>>();
	let queue = Promise.resolve();

	async function ask(alias: string, text: string, pid: number, signal: AbortSignal): Promise<string | undefined> {
		if (signal.aborted) return undefined;
		const kind = sshPromptKind(text);
		for (const ssh of cancelled.keys()) if (!isAlive(ssh)) cancelled.delete(ssh);
		if (cancelled.get(pid)?.has(text)) {
			log(`ssh prompt (${kind}) for ${alias}: cancelled, the same prompt of this ssh was cancelled`);
			return undefined;
		}
		log(`ssh prompt (${kind}) for ${alias}: shown`);
		let answer: string | undefined;
		try {
			answer = await input.prompt({ alias, text, kind, signal });
		} catch (error) {
			log(`ssh prompt (${kind}) for ${alias}: failed: ${(error as Error).message}`);
			return undefined;
		}
		if (answer === undefined) cancelled.set(pid, (cancelled.get(pid) ?? new Set()).add(text));
		log(`ssh prompt (${kind}) for ${alias}: ${answer === undefined ? "cancelled" : "answered"}`);
		return answer;
	}

	const sockets = new Set<Socket>();

	function serve(socket: Socket) {
		const closed = new AbortController();
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
			closed.abort();
		});
		socket.on("error", () => socket.destroy());
		socket.setEncoding("utf8");
		let buffer = "";
		const onData = (chunk: string) => {
			buffer += chunk;
			const end = buffer.indexOf("\n");
			if (end < 0) {
				if (buffer.length > MAX_REQUEST_BYTES) socket.destroy();
				return;
			}
			socket.off("data", onData);
			const request = parseRequest(buffer.slice(0, end));
			if (!request) return void socket.destroy();
			const turn = queue.then(() => ask(request.alias, request.text, request.pid, closed.signal));
			queue = turn.then(() => undefined);
			void turn.then((answer) => {
				if (!socket.destroyed) socket.end(`${JSON.stringify(answer === undefined ? { cancelled: true } : { answer })}\n`);
			});
		};
		socket.on("data", onData);
	}

	const server = createServer(serve);
	await rm(socketPath, { force: true });
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => resolve());
	});
	await chmod(socketPath, 0o600);

	return {
		env(alias) {
			const valid = validateSshAlias(alias);
			if (!valid.ok) throw new Error(`SSH alias ${JSON.stringify(alias)} ${valid.reason}.`);
			return {
				SSH_ASKPASS: scriptPath,
				SSH_ASKPASS_REQUIRE: "force",
				// OpenSSH before 8.4 ignores SSH_ASKPASS_REQUIRE and uses askpass only with DISPLAY set and no tty.
				DISPLAY: process.env.DISPLAY || "whiteboard-askpass:0",
				[REVIEW_SSH_ASKPASS_SOCKET_ENV]: socketPath,
				[REVIEW_SSH_ASKPASS_ALIAS_ENV]: alias,
			};
		},
		dispose() {
			server.close();
			for (const socket of sockets) socket.destroy();
			rmSync(socketPath, { force: true });
			rmSync(scriptPath, { force: true });
		},
	};
}

function parseRequest(line: string): { alias: string; text: string; pid: number } | undefined {
	try {
		const { alias, text, pid } = JSON.parse(line) as Record<string, unknown>;
		if (typeof alias !== "string" || !validateSshAlias(alias).ok) return undefined;
		if (typeof text !== "string" || !Number.isInteger(pid) || (pid as number) < 2) return undefined;
		return { alias, text, pid: pid as number };
	} catch {
		return undefined;
	}
}
