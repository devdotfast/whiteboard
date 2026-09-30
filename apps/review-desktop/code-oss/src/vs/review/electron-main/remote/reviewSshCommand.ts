/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Development only: an ssh_config file every `ssh` call and the alias list
 * use, because OpenSSH finds `~/.ssh` from the account, not from `HOME`.
 */
export const REVIEW_SSH_CONFIG_ENV = "DEV_FAST_REVIEW_SSH_CONFIG";

/** One master connection per alias; every other call reuses it through `controlPath`. */
export interface ReviewSshSession {
	readonly alias: string;
	readonly controlPath: string;
}

export function validateSshAlias(alias: string): { ok: true } | { ok: false; reason: string } {
	if (!alias) return { ok: false, reason: "is empty" };
	if (alias.startsWith("-")) return { ok: false, reason: "starts with -" };
	if (/\s/.test(alias)) return { ok: false, reason: "contains whitespace" };
	if (/[\x00-\x1f\x7f-\x9f]/.test(alias)) return { ok: false, reason: "contains a control character" };
	const meta = /[`$;|&<>()'"\\]/.exec(alias);
	if (meta) return { ok: false, reason: `contains ${meta[0]}` };
	return { ok: true };
}

/** Connection sharing needs Unix sockets and a uid; Windows has neither. */
function currentUid(): number {
	if (!process.getuid) throw new Error("SSH connection sharing is not supported on this platform.");
	return process.getuid();
}

/** Per user and short: macOS limits a socket path to about 104 bytes, and ssh appends 17 to it while binding. */
export function reviewSshControlDirectory(): string {
	return join(tmpdir(), `wb-ssh-${currentUid()}`);
}

/** The caller runs `prepareSshControlDirectory` before starting the master. */
export function reviewSshSession(alias: string, controlDirectory = reviewSshControlDirectory()): ReviewSshSession {
	checkAlias(alias);
	const name = createHash("sha256").update(alias).digest("hex").slice(0, 12);
	return { alias, controlPath: join(controlDirectory, name) };
}

function checkAlias(alias: string): void {
	const valid = validateSshAlias(alias);
	if (!valid.ok) throw new Error(`SSH alias ${JSON.stringify(alias)} ${valid.reason}.`);
}

/** Creates the directory 0700, repairs its mode, and refuses one this user does not own. */
export async function prepareSshControlDirectory(dir: string): Promise<void> {
	await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "EEXIST") throw error;
	});
	const stat = await lstat(dir);
	if (!stat.isDirectory() || stat.uid !== currentUid()) {
		throw new Error(`${dir} is not a directory owned by this user.`);
	}
	if ((stat.mode & 0o777) !== 0o700) await chmod(dir, 0o700);
}

/** An unpackaged Desktop only: `VSCODE_DEV` is what `isBuilt` reads. */
function developmentConfig(env: NodeJS.ProcessEnv): string | undefined {
	return env.VSCODE_DEV ? env[REVIEW_SSH_CONFIG_ENV] || undefined : undefined;
}

/** The file the alias list reads. */
export function reviewSshConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
	return developmentConfig(env) ?? join(home, ".ssh", "config");
}

function base(session: ReviewSshSession, env: NodeJS.ProcessEnv): string[] {
	checkAlias(session.alias);
	const config = developmentConfig(env);
	return [...(config ? ["-F", config] : []), "-S", session.controlPath];
}

export function sshMasterArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [
		...base(session, env),
		"-M",
		"-N",
		"-oServerAliveInterval=15",
		"-oServerAliveCountMax=3",
		"-oControlPersist=no",
		"--",
		session.alias,
	];
}

/** Runs `sh -s` whatever the login shell; the caller writes the script to stdin. */
export function sshExecArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-oControlMaster=no", "-T", "--", session.alias, "sh", "-s"];
}

function localForward(localPort: number, remotePort: number): string {
	for (const port of [localPort, remotePort]) {
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port ${port}.`);
	}
	return `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`;
}

/** Asks the master for the listener and exits: 0 once it listens, 255 with OpenSSH's text if not. */
export function sshForwardArgs(
	session: ReviewSshSession,
	localPort: number,
	remotePort: number,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return [...base(session, env), "-O", "forward", "-L", localForward(localPort, remotePort), "--", session.alias];
}

export function sshCancelForwardArgs(
	session: ReviewSshSession,
	localPort: number,
	remotePort: number,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return [...base(session, env), "-O", "cancel", "-L", localForward(localPort, remotePort), "--", session.alias];
}

export function sshCloseArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-O", "exit", "--", session.alias];
}
