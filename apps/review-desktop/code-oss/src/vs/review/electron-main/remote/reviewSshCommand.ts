/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { validateSshAlias } from "../../common/reviewSshAlias.js";

export { validateSshAlias };

/**
 * Development only: an ssh_config file every `ssh` call and the alias list
 * use, because OpenSSH finds `~/.ssh` from the account, not from `HOME`.
 */
export const REVIEW_SSH_CONFIG_ENV = "DEV_FAST_REVIEW_SSH_CONFIG";

export interface ReviewSshSession {
	readonly alias: string;
	readonly controlPath: string;
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

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function reviewSshInstancePrefix(instance: string): string {
	return `${sha(instance).slice(0, 6)}-`;
}

export function reviewSshSession(alias: string, controlDirectory = reviewSshControlDirectory(), instance?: string): ReviewSshSession {
	checkAlias(alias);
	const name = instance === undefined ? sha(alias).slice(0, 12) : `${reviewSshInstancePrefix(instance)}${sha(`${instance}\n${alias}`).slice(0, 12)}`;
	return { alias, controlPath: join(controlDirectory, name) };
}

function checkAlias(alias: string): void {
	const valid = validateSshAlias(alias);
	if (!valid.ok) throw new Error(`SSH alias ${JSON.stringify(alias)} ${valid.reason}.`);
}

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

function developmentConfig(env: NodeJS.ProcessEnv): string | undefined {
	return env.VSCODE_DEV ? env[REVIEW_SSH_CONFIG_ENV] || undefined : undefined;
}

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

export function sshExecArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-oControlMaster=no", "-T", "--", session.alias, "sh", "-s"];
}

function localForward(localPort: number, remotePort: number): string {
	for (const port of [localPort, remotePort]) {
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port ${port}.`);
	}
	return `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`;
}

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

export function sshCheckArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-O", "check", "--", session.alias];
}

export function sshCloseArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-O", "exit", "--", session.alias];
}
