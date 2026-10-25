/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { validateSshAlias } from "../../common/reviewSshAlias.js";

/**
 * Development only: an ssh_config file every `ssh` call and the alias list
 * use, because OpenSSH finds `~/.ssh` from the account, not from `HOME`.
 */
export const REVIEW_SSH_CONFIG_ENV = "DEV_FAST_REVIEW_SSH_CONFIG";

/** Development only: run the Windows connection model on macOS or Linux. */
export const REVIEW_SSH_DIRECT_ENV = "DEV_FAST_REVIEW_SSH_DIRECT";

/**
 * Without `controlPath` the session is direct: ssh never prompts, every command opens its own
 * connection, and the master only serves a SOCKS port. Win32-OpenSSH has no ControlMaster.
 */
export interface ReviewSshSession {
	readonly alias: string;
	readonly controlPath?: string;
}

export function reviewSshSharesConnections(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
	return platform !== "win32" && !(env.VSCODE_DEV && env[REVIEW_SSH_DIRECT_ENV] === "1");
}

/** On Windows, the inbox Win32-OpenSSH rather than an MSYS ssh, such as Git for Windows', earlier on PATH. */
export function reviewSshBinary(env: NodeJS.ProcessEnv = process.env, platform = process.platform, exists = existsSync): string {
	if (platform !== "win32") return "ssh";
	const inbox = win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
	return exists(inbox) ? inbox : "ssh";
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

export function reviewSshSession(alias: string, controlDirectory: string, instance: string): Required<ReviewSshSession> {
	checkAlias(alias);
	const name = `${reviewSshInstancePrefix(instance)}${sha(`${instance}\n${alias}`).slice(0, 12)}`;
	return { alias, controlPath: join(controlDirectory, name) };
}

export function reviewSshDirectSession(alias: string): ReviewSshSession {
	checkAlias(alias);
	return { alias };
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
	const config = developmentConfig(env);
	return [...(config ? ["-F", config] : []), ...(session.controlPath ? ["-S", session.controlPath] : ["-oBatchMode=yes"])];
}

function shared(session: ReviewSshSession, env: NodeJS.ProcessEnv): string[] {
	if (!session.controlPath) throw new Error(`The SSH connection to ${session.alias} is not shared.`);
	return base(session, env);
}

function checkPort(port: number | undefined): number {
	if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port ${port}.`);
	return port;
}

const KEEPALIVE = ["-oServerAliveInterval=15", "-oServerAliveCountMax=3"];

/** A direct master only holds the connection and serves `socksPort`, which ssh binds after logging in. */
export function sshMasterArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env, socksPort?: number): string[] {
	if (!session.controlPath) {
		return [...base(session, env), "-N", "-T", "-D", `127.0.0.1:${checkPort(socksPort)}`, "-oExitOnForwardFailure=yes", ...KEEPALIVE, "--", session.alias];
	}
	return [...base(session, env), "-M", "-N", ...KEEPALIVE, "-oControlPersist=no", "--", session.alias];
}

export function sshExecArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env, command: readonly string[] = ["sh", "-s"]): string[] {
	return [...base(session, env), ...(session.controlPath ? ["-oControlMaster=no"] : []), "-T", "--", session.alias, ...command];
}

function localForward(localPort: number, remotePort: number): string {
	return `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`;
}

export function sshForwardArgs(
	session: ReviewSshSession,
	localPort: number,
	remotePort: number,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return [...shared(session, env), "-O", "forward", "-L", localForward(localPort, remotePort), "--", session.alias];
}

export function sshCancelForwardArgs(
	session: ReviewSshSession,
	localPort: number,
	remotePort: number,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return [...shared(session, env), "-O", "cancel", "-L", localForward(localPort, remotePort), "--", session.alias];
}

export function sshCheckArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...shared(session, env), "-O", "check", "--", session.alias];
}

export function sshCloseArgs(session: ReviewSshSession, env: NodeJS.ProcessEnv = process.env): string[] {
	return [...shared(session, env), "-O", "exit", "--", session.alias];
}
