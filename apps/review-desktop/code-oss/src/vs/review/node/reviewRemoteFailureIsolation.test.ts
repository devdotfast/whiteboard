/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AddressInfo, createConnection, createServer, Server, Socket } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';
import { VSBuffer } from '../../base/common/buffer.js';
import { Emitter, Event } from '../../base/common/event.js';
import { ClientConnectionEvent, IPCServer } from '../../base/parts/ipc/common/ipc.js';
import { PersistentProtocol } from '../../base/parts/ipc/common/ipc.net.js';
import { NodeSocket } from '../../base/parts/ipc/node/ipc.net.js';
import { NullLogService } from '../../platform/log/common/log.js';
import { connectRemoteAgentManagement, IConnectionOptions, ManagementPersistentConnection, PersistentConnection, PersistentConnectionEventType } from '../../platform/remote/common/remoteAgentConnection.js';
import { RemoteConnectionType, WebSocketRemoteConnection } from '../../platform/remote/common/remoteAuthorityResolver.js';
import { RemoteSocketFactoryService } from '../../platform/remote/common/remoteSocketFactoryService.js';
import { ISignService } from '../../platform/sign/common/sign.js';

// The client's handshake and reconnect timeouts (10 s, 30 s) are never cleared,
// and its LoadEstimator ticks for the life of the process. Unreference them so
// this file exits when its tests end; open sockets keep it alive until then.
const setTimeoutReferenced = globalThis.setTimeout;
const setIntervalReferenced = globalThis.setInterval;

const signService: ISignService = {
	_serviceBrand: undefined,
	createNewMessage: async data => ({ id: data, data }),
	validate: async () => true,
	sign: async data => data,
};

const json = (message: object) => VSBuffer.fromString(JSON.stringify(message));

class FakeRemote {
	private readonly server: Server = createServer(socket => this.accept(socket));
	private readonly sockets = new Set<Socket>();
	private readonly protocols = new Map<Socket, PersistentProtocol>();
	private readonly clients = new Emitter<ClientConnectionEvent>();
	private readonly ipc = new IPCServer(this.clients.event);
	port = 0;

	constructor() {
		this.ipc.registerChannel('echo', { call: async (_ctx, _command, arg) => arg, listen: () => Event.None });
	}

	async start(port = 0): Promise<void> {
		this.server.listen(port, '127.0.0.1');
		await once(this.server, 'listening');
		this.port = (this.server.address() as AddressInfo).port;
	}

	// The protocol goes first: its writer would write to the ended socket.
	restart(): void {
		for (const socket of this.sockets) {
			this.protocols.get(socket)?.dispose();
			socket.end();
		}
	}

	async stop(): Promise<void> {
		this.restart();
		this.ipc.dispose();
		await new Promise(resolve => this.server.close(resolve));
	}

	private accept(socket: Socket): void {
		this.sockets.add(socket);
		socket.once('close', () => {
			this.sockets.delete(socket);
			this.protocols.delete(socket);
		});
		socket.once('data', (chunk: Buffer) => {
			const newline = chunk.indexOf(10);
			const query = new URLSearchParams(chunk.subarray(0, newline).toString());
			const rest = chunk.subarray(newline + 1);
			const protocol = new PersistentProtocol({ socket: new NodeSocket(socket), initialChunk: rest.length ? VSBuffer.wrap(rest) : null });
			this.protocols.set(socket, protocol);
			Event.once(protocol.onControlMessage)(() => {
				protocol.sendControl(json({ type: 'sign', data: 'data', signedData: 'data' }));
				Event.once(protocol.onControlMessage)(() => {
					if (query.get('reconnection') === 'true') {
						protocol.sendControl(json({ type: 'error', reason: 'Unknown reconnection token (never seen)' }));
						return;
					}
					protocol.sendControl(json({ type: 'ok' }));
					this.clients.fire({ protocol, onDidClientDisconnect: Event.None });
				});
			});
		});
	}
}

function options(remote: FakeRemote): IConnectionOptions {
	const remoteSocketFactoryService = new RemoteSocketFactoryService();
	remoteSocketFactoryService.register(RemoteConnectionType.WebSocket, {
		supports: () => true,
		connect: async (connectTo, _path, query) => {
			const socket = createConnection(connectTo.port, connectTo.host);
			await once(socket, 'connect');
			socket.write(`${query}\n`);
			return new NodeSocket(socket);
		},
	});
	return {
		commit: undefined,
		quality: undefined,
		addressProvider: { getAddress: async () => ({ connectTo: new WebSocketRemoteConnection('127.0.0.1', remote.port), connectionToken: undefined }) },
		remoteSocketFactoryService,
		signService,
		logService: new NullLogService(),
		ipcLogger: null,
	};
}

let remotes: FakeRemote[];
let connections: ManagementPersistentConnection[];

beforeEach(() => {
	remotes = [];
	connections = [];
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => (setTimeoutReferenced(...args) as unknown as NodeJS.Timeout).unref()) as unknown as typeof setTimeout;
	globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (setIntervalReferenced(...args) as unknown as NodeJS.Timeout).unref()) as unknown as typeof setInterval;
});

afterEach(async () => {
	for (const connection of connections) {
		connection.dispose();
	}
	await Promise.all(remotes.map(remote => remote.stop()));
	globalThis.setTimeout = setTimeoutReferenced;
	globalThis.setInterval = setIntervalReferenced;
});

async function startRemote(port = 0): Promise<FakeRemote> {
	const remote = new FakeRemote();
	remotes.push(remote);
	await remote.start(port);
	return remote;
}

async function connect(remote: FakeRemote, authority: string): Promise<ManagementPersistentConnection> {
	const connection = await connectRemoteAgentManagement(options(remote), authority, 'renderer');
	connections.push(connection);
	return connection;
}

async function echo(connection: ManagementPersistentConnection, text: string): Promise<string> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const noReply = new Promise<never>((_, reject) => timer = setTimeoutReferenced(() => reject(new Error(`no reply to ${text}`)), 2_000));
	try {
		return await Promise.race([connection.client.getChannel('echo').call<string>('echo', text), noReply]);
	} finally {
		clearTimeout(timer);
	}
}

async function failPermanently(remote: FakeRemote, connection: ManagementPersistentConnection): Promise<void> {
	const failed = Event.toPromise(Event.filter(connection.onDidStateChange, e => e.type === PersistentConnectionEventType.ReconnectionPermanentFailure));
	remote.restart();
	await failed;
}

test('a permanent reconnection failure of one authority leaves another authority sending and receiving', async () => {
	const [a, b] = [await startRemote(), await startRemote()];
	const [toA, toB] = [await connect(a, 'wb-test+a'), await connect(b, 'wb-test+b')];
	assert.equal(await echo(toB, 'b'), 'b');

	await failPermanently(b, toB);

	assert.equal(await echo(toA, 'a'), 'a');
});

test('a connection that failed permanently does not start reconnecting again', async () => {
	const b = await startRemote();
	const toB = await connect(b, 'wb-test+b');
	await failPermanently(b, toB);
	const events: PersistentConnectionEventType[] = [];
	toB.onDidStateChange(e => events.push(e.type));

	PersistentConnection.debugTriggerReconnection();
	await new Promise(resolve => setTimeoutReferenced(resolve, 100));

	assert.deepEqual(events, []);
});

test('a failed initial connection to one authority leaves another authority sending and receiving', async () => {
	const a = await startRemote();
	const toA = await connect(a, 'wb-test+a');
	const down = await startRemote();
	await down.stop();

	await assert.rejects(connect(down, 'wb-test+b'), { code: 'ECONNREFUSED' });

	assert.equal(await echo(toA, 'a'), 'a');
});

test('a new connection to an authority that failed succeeds once its server is back', async () => {
	const [a, b] = [await startRemote(), await startRemote()];
	const [toA, toB] = [await connect(a, 'wb-test+a'), await connect(b, 'wb-test+b')];
	await failPermanently(b, toB);
	await b.stop();
	await assert.rejects(connect(b, 'wb-test+b'), { code: 'ECONNREFUSED' });

	const back = await startRemote(b.port);
	const again = await connect(back, 'wb-test+b');

	assert.equal(await echo(again, 'b again'), 'b again');
	assert.equal(await echo(toA, 'a'), 'a');
});

test('a new connection to a third authority succeeds after another authority failed', async () => {
	const [a, b, c] = [await startRemote(), await startRemote(), await startRemote()];
	const toA = await connect(a, 'wb-test+a');
	const toB = await connect(b, 'wb-test+b');
	await failPermanently(b, toB);

	const toC = await connect(c, 'wb-test+c');

	assert.equal(await echo(toC, 'c'), 'c');
	assert.equal(await echo(toA, 'a'), 'a');
});
