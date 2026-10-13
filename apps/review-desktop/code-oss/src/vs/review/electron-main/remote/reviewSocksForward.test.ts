/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import test from "node:test";

import { socksAnswers, socksForward } from "./reviewSocksForward.js";

async function listen(server: Server): Promise<number> {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return (server.address() as AddressInfo).port;
}

/** Like OpenSSH's -D: no auth, CONNECT only, and the reply before the far end answers. */
function fakeSocks(): Server {
	return createServer({ allowHalfOpen: true }, (client) => {
		client.once("data", () => {
			client.write(Buffer.from([5, 0]));
			client.once("data", (request: Buffer) => {
				const port = request.readUInt16BE(8);
				client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
				const far = connect(port, "127.0.0.1");
				far.on("error", () => client.destroy());
				client.on("error", () => far.destroy());
				client.pipe(far).pipe(client);
			});
		});
	});
}

const echo = () => createServer((socket) => socket.pipe(socket));

async function roundTrip(port: number, text: string): Promise<string> {
	const socket = connect(port, "127.0.0.1");
	socket.end(text);
	let answer = "";
	for await (const chunk of socket) answer += chunk;
	return answer;
}

test("a forward reaches the far port through the SOCKS port, and close ends its connections", async (t) => {
	const socks = fakeSocks();
	const far = echo();
	t.after(() => {
		socks.close();
		far.close();
	});
	const forward = await socksForward(await listen(socks), await listen(far));
	assert.equal(await roundTrip(forward.port, "hello"), "hello");

	const open: Socket = connect(forward.port, "127.0.0.1");
	open.write("x");
	await once(open, "data");
	await forward.close();
	await once(open, "close");
	await assert.rejects(roundTrip(forward.port, "again"));
});

test("a far port that refuses closes the forwarded connection", async (t) => {
	const socks = fakeSocks();
	const closed = echo();
	const closedPort = await listen(closed);
	closed.close();
	t.after(() => socks.close());
	const forward = await socksForward(await listen(socks), closedPort);
	t.after(() => forward.close());
	assert.equal(await roundTrip(forward.port, "hello").catch(() => ""), "");
});

test("socksAnswers is true only for a SOCKS port", async (t) => {
	const socks = fakeSocks();
	const silent = createServer((socket) => socket.end());
	t.after(() => {
		socks.close();
		silent.close();
	});
	assert.equal(await socksAnswers(await listen(socks)), true);
	assert.equal(await socksAnswers(await listen(silent)), false);
	const gone = echo();
	const gonePort = await listen(gone);
	gone.close();
	assert.equal(await socksAnswers(gonePort), false);
});
