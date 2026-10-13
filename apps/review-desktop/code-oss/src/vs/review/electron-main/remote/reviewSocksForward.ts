/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { connect, createServer, type AddressInfo, type Socket } from "node:net";

const LOOPBACK = "127.0.0.1";
const HANDSHAKE_MS = 10_000;
const noop = () => {};

function read(socket: Socket, length: number): Promise<{ head: Buffer; rest: Buffer }> {
	return new Promise((resolve, reject) => {
		let buffered = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			buffered = Buffer.concat([buffered, chunk]);
			if (buffered.length < length) return;
			socket.pause();
			done();
			resolve({ head: buffered.subarray(0, length), rest: buffered.subarray(length) });
		};
		const onClose = () => {
			done();
			reject(new Error("The SSH SOCKS port closed the connection."));
		};
		const done = () => {
			socket.off("data", onData);
			socket.off("close", onClose);
		};
		socket.on("data", onData);
		socket.once("close", onClose);
		socket.resume();
	});
}

async function greet(socket: Socket): Promise<void> {
	socket.setTimeout(HANDSHAKE_MS, () => socket.destroy());
	socket.write(Buffer.from([5, 1, 0]));
	const { head } = await read(socket, 2);
	if (head[0] !== 5 || head[1] !== 0) throw new Error("The SSH SOCKS port refused the greeting.");
}

/** ssh binds its SOCKS port only after logging in, so an answer means the connection is up. */
export async function socksAnswers(socksPort: number): Promise<boolean> {
	const socket = connect(socksPort, LOOPBACK).on("error", noop);
	try {
		await greet(socket);
		return true;
	} catch {
		return false;
	} finally {
		socket.destroy();
	}
}

async function socksConnect(socksPort: number, port: number): Promise<{ socket: Socket; rest: Buffer }> {
	const socket = connect({ port: socksPort, host: LOOPBACK, allowHalfOpen: true }).on("error", noop);
	try {
		await greet(socket);
		socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, port >> 8, port & 255]));
		// OpenSSH answers with an IPv4 address, and before the remote end accepts: a refusal closes the socket later.
		const reply = await read(socket, 10);
		if (reply.head[1] !== 0) throw new Error(`The SSH SOCKS port could not reach port ${port} (reply ${reply.head[1]}).`);
		socket.setTimeout(0);
		return { socket, rest: reply.rest };
	} catch (error) {
		socket.destroy();
		throw error;
	}
}

export interface ReviewSocksForward {
	readonly port: number;
	close(): Promise<void>;
}

/** A loopback port whose connections reach 127.0.0.1:`remotePort` on the host, through ssh's SOCKS port. */
export async function socksForward(socksPort: number, remotePort: number): Promise<ReviewSocksForward> {
	const sockets = new Set<Socket>();
	const track = (socket: Socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	};
	// Half-open like ssh -L: a client that ends its request still gets the answer.
	const server = createServer({ allowHalfOpen: true }, (local) => {
		track(local);
		local.on("error", noop).pause();
		socksConnect(socksPort, remotePort).then(({ socket, rest }) => {
			track(socket);
			if (local.destroyed) return void socket.destroy();
			// Ends pass through the pipes; destroying on a clean close could cut an answer still flushing.
			socket.once("close", (failed: boolean) => failed && local.destroy());
			local.once("close", (failed: boolean) => failed && socket.destroy());
			if (rest.length) local.write(rest);
			socket.pipe(local);
			local.pipe(socket);
		}, () => local.destroy());
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, LOOPBACK, () => resolve());
	});
	return {
		port: (server.address() as AddressInfo).port,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
				for (const socket of sockets) socket.destroy();
			}),
	};
}
