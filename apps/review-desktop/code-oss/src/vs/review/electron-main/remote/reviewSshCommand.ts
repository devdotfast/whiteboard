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

/** One master connection per alias; every other call reuses it through `controlPath`. */
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

/** Every socket name of one Desktop starts with this, so it can sweep its own orphans and no one else's. */
export function reviewSshInstancePrefix(instance: string): string {
	return `${sha(instance).slice(0, 6)}-`;
}

/**
 * The caller runs `prepareSshControlDirectory` before starting the master.
 * `instance` keeps two Desktops that share the directory off each other's sockets.
 */
export function reviewSshSession(alias: string, controlDirectory = reviewSshControlDirectory(), instance?: string): ReviewSshSession {
	checkAlias(alias);
	const name = instance === undefined ? sha(alias).slice(0, 12) : `${reviewSshInstancePrefix(instance)}${sha(`${instance}\n${alias}`).slice(0, 12)}`;
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

/**
 * Runs `sh -s` whatever the login shell; the caller writes the script to stdin.
 * Another `command` reaches the login shell as one line, so it must quote alike in every shell.
 */
export function sshExecArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env, command: readonly string[] = ["sh", "-s"]): string[] {
	return [...base(session, env), "-oControlMaster=no", "-T", "--", session.alias, ...command];
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

/**
 * Asks the master to listen on a port the remote picks, on its loopback, and
 * carry it to `localPort` here; ssh prints the port it got. Cancel with the
 * same arguments and "cancel": OpenSSH matches the request as it was made, port 0.
 */
export function sshRemoteForwardArgs(
	session: ReviewSshSession,
	localPort: number,
	operation: "forward" | "cancel",
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error(`Invalid port ${localPort}.`);
	return [...base(session, env), "-O", operation, "-R", `127.0.0.1:0:127.0.0.1:${localPort}`, "--", session.alias];
}

/** Exits 0 while the master answers on its socket. Run before an exec: without a master, ssh would authenticate again. */
export function sshCheckArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-O", "check", "--", session.alias];
}

export function sshCloseArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...base(session, env), "-O", "exit", "--", session.alias];
}
