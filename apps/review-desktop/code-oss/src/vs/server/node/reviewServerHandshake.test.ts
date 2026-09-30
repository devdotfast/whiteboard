/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Schemas } from '../../base/common/network.js';
import { URI } from '../../base/common/uri.js';
import { LoadEstimator } from '../../base/parts/ipc/common/ipc.net.js';
import { NullLogService } from '../../platform/log/common/log.js';
import { connectRemoteAgentExtensionHost, connectRemoteAgentManagement, IConnectionOptions } from '../../platform/remote/common/remoteAgentConnection.js';
import { RemoteConnectionType, WebSocketRemoteConnection } from '../../platform/remote/common/remoteAuthorityResolver.js';
import { RemoteSocketFactoryService } from '../../platform/remote/common/remoteSocketFactoryService.js';
import { nodeSocketFactory } from '../../platform/remote/node/nodeSocketFactory.js';
import { SignService } from '../../platform/sign/node/signService.js';
import { createMessageOfType, isMessageOfType, MessageType } from '../../workbench/services/extensions/common/extensionHostProtocol.js';
import { RemoteExtensionEnvironmentChannelClient } from '../../workbench/services/remote/common/remoteAgentEnvironmentChannel.js';

// Starts `server-main` from a freshly built `remote-runtime/` on this Node and
// connects with the client code the Desktop uses for a remote connection.
//
// With REVIEW_SERVER_HANDSHAKE_TARGET=<host>:<port> and
// REVIEW_SERVER_HANDSHAKE_TOKEN_FILE=<file>, it instead runs the handshake
// against a server started elsewhere, for example through an SSH tunnel, and
// holds the connections for REVIEW_SERVER_HANDSHAKE_HOLD_MS before leaving.

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const AUTHORITY = 'wb-test+handshake';
const scripts = join(import.meta.dirname, '../../../../../scripts');

// The client's LoadEstimator ticks every second for the life of the process.
// Create it with an unreferenced interval so this test process can exit.
// The client's 10 s handshake timeouts are never cleared either; the package's
// test command runs this directory with --test-force-exit so they are not waited out.
const setIntervalReferenced = globalThis.setInterval;
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (setIntervalReferenced(...args) as unknown as NodeJS.Timeout).unref()) as unknown as typeof setInterval;
LoadEstimator.getInstance();
globalThis.setInterval = setIntervalReferenced;

interface Target {
	readonly host: string;
	readonly port: number;
	readonly token: string;
}

function connectionOptions(target: Target, overrides: { commit?: string; token?: string } = {}): IConnectionOptions {
	const remoteSocketFactoryService = new RemoteSocketFactoryService();
	remoteSocketFactoryService.register(RemoteConnectionType.WebSocket, nodeSocketFactory);
	return {
		commit: overrides.commit ?? COMMIT,
		quality: undefined,
		addressProvider: { getAddress: async () => ({ connectTo: new WebSocketRemoteConnection(target.host, target.port), connectionToken: overrides.token ?? target.token }) },
		remoteSocketFactoryService,
		signService: new SignService(),
		logService: new NullLogService(),
		ipcLogger: null,
	};
}

async function handshake(target: Target, commit = COMMIT) {
	const options = connectionOptions(target, { commit });
	const management = await connectRemoteAgentManagement(options, AUTHORITY, 'renderer');
	const environment = await RemoteExtensionEnvironmentChannelClient.getEnvironmentData(management.client.getChannel('remoteextensionsenvironment'), AUTHORITY, undefined);
	const extensionHost = await connectRemoteAgentExtensionHost(options, { language: 'en' });
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('the extension host did not send Ready')), 30_000);
		const listener = extensionHost.protocol.onMessage(message => {
			if (isMessageOfType(message, MessageType.Ready)) {
				clearTimeout(timer);
				listener.dispose();
				resolve();
			}
		});
	});
	return { management, environment, extensionHost };
}

// What the Desktop does when it closes a window: terminate the extension host, then disconnect.
function close({ management, extensionHost }: Awaited<ReturnType<typeof handshake>>): void {
	extensionHost.protocol.send(createMessageOfType(MessageType.Terminate));
	extensionHost.protocol.sendDisconnect();
	extensionHost.protocol.getSocket().end();
	extensionHost.protocol.dispose();
	extensionHost.dispose();
	management.dispose();
}

async function version(target: Target): Promise<string> {
	const response = await fetch(`http://${target.host}:${target.port}/version`);
	return response.text();
}

const external = process.env['REVIEW_SERVER_HANDSHAKE_TARGET'];
if (external) {
	test('completes the handshake with a server started elsewhere, which survives the client leaving', async () => {
		const [host, port] = external.split(':');
		const tokenFile = process.env['REVIEW_SERVER_HANDSHAKE_TOKEN_FILE'];
		assert.ok(tokenFile, 'REVIEW_SERVER_HANDSHAKE_TOKEN_FILE is required');
		const target = { host, port: Number(port), token: readFileSync(tokenFile, 'utf8').trim() };
		const started = Date.now();
		const connection = await handshake(target, await version(target));
		console.log(`extension host Ready after ${Date.now() - started} ms; server pid ${connection.environment.pid}, ${connection.environment.arch}`);
		await new Promise(resolve => setTimeout(resolve, Number(process.env['REVIEW_SERVER_HANDSHAKE_HOLD_MS'] ?? 0)));
		close(connection);
		await new Promise(resolve => setTimeout(resolve, 2_000));
		assert.match(await version(target), /^[0-9a-f]{40}$/);
	});
} else {
	let root: string;
	let server: ChildProcess;
	let output = '';
	let target: Target;

	before(async () => {
		root = mkdtempSync(join(tmpdir(), 'wb-server-'));
		const runtime = join(root, 'remote-runtime');
		execFileSync(process.execPath, [join(scripts, 'build-remote-runtime.mjs'), '--out', runtime, '--commit', COMMIT], { stdio: 'pipe' });
		const tokenFile = join(root, 'token');
		writeFileSync(tokenFile, 'test-token', { mode: 0o600 });
		server = spawn(process.execPath, [
			join(runtime, 'out/server-main.js'),
			'--host', '127.0.0.1',
			'--port', '0',
			'--connection-token-file', tokenFile,
			'--server-data-dir', join(root, 'data'),
			'--extensions-dir', join(root, 'extensions'),
		], { stdio: ['ignore', 'pipe', 'pipe'] });
		server.stdout!.on('data', chunk => output += chunk);
		server.stderr!.on('data', chunk => output += chunk);
		const port = await new Promise<number>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`the server did not start:\n${output}`)), 30_000);
			server.stdout!.on('data', () => {
				const match = /Extension host agent listening on (\d+)/.exec(output);
				if (match) {
					clearTimeout(timer);
					resolve(Number(match[1]));
				}
			});
		});
		target = { host: '127.0.0.1', port, token: 'test-token' };
	});

	after(async () => {
		server?.kill();
		for (const match of output.matchAll(/<(\d+)> Launched Extension Host Process/g)) {
			try {
				process.kill(Number(match[1]));
			} catch {
				// already gone with its server
			}
		}
		rmSync(root, { recursive: true, force: true });
	});

	test('completes a Management then an ExtensionHost connection, and the extension host sends Ready', async () => {
		const connection = await handshake(target);
		assert.equal(connection.environment.pid, server.pid);
		assert.match(output, /Launched Extension Host Process/);
		close(connection);
	});

	test('a client that disconnects cleanly leaves the server running', async () => {
		const connection = await handshake(target);
		// Without @parcel/watcher the recursive watcher process fails; the disconnect then
		// cancels its pending request, an unhandled rejection that once killed the server.
		const files = connection.management.client.getChannel('remoteFilesystem');
		const session = 'handshake-test';
		const listener = files.listen('fileChange', [session])(() => { });
		await files.call('watch', [session, 1, URI.from({ scheme: Schemas.vscodeRemote, authority: AUTHORITY, path: root }), { recursive: true, excludes: [] }]);
		listener.dispose();
		close(connection);
		await new Promise(resolve => setTimeout(resolve, 1_500));
		assert.equal(server.exitCode, null, output);
		assert.equal(await version(target), COMMIT);
		close(await handshake(target));
	});

	// A refused initial connection sets a static permanent-failure flag in the
	// client, so these run after the connections that must succeed.
	test('refuses a wrong connection token', async () => {
		await assert.rejects(connectRemoteAgentManagement(connectionOptions(target, { token: 'wrong' }), AUTHORITY, 'renderer'), /Unauthorized client refused: auth mismatch/);
	});

	test('refuses a client built from another commit', async () => {
		await assert.rejects(connectRemoteAgentManagement(connectionOptions(target, { commit: 'f'.repeat(40) }), AUTHORITY, 'renderer'), /Client refused: version mismatch/);
	});
}
