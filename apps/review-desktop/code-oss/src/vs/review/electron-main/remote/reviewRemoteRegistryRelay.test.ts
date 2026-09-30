/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { startRegistryRelay, type ReviewRegistryRelay } from "./reviewRemoteRegistryRelay.js";

/** A registry on a loopback port that records what reached it. */
async function fakeRegistry(t: test.TestContext) {
	const seen: string[] = [];
	const tarball = Buffer.alloc(300_000, 7);
	let origin = "";
	const server: Server = createServer((req, res) => {
		seen.push(`${req.method} ${req.url}`);
		if (req.url === "/left-pad" || req.url === "/@dev.fast%2fdiffr") {
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					name: "left-pad",
					versions: {
						"1.0.0": { dist: { tarball: `${origin}/left-pad/-/left-pad-1.0.0.tgz`, integrity: "sha512-x" } },
						"0.9.0": { dist: { tarball: "https://elsewhere.example/left-pad-0.9.0.tgz" } },
					},
				}),
			);
		} else if (req.url === "/left-pad/-/left-pad-1.0.0.tgz") {
			res.setHeader("content-type", "application/octet-stream");
			res.end(tarball);
		} else {
			res.statusCode = 404;
			res.end("{}");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return { origin, seen, tarball };
}

async function relayFor(t: test.TestContext, upstream: string, limits?: { tarball?: number }) {
	const relay = await startRegistryRelay({ upstream, limits });
	t.after(() => relay.close());
	return relay;
}

/** A raw request, so the method, path and Host are exactly what the test says. */
function send(relay: ReviewRegistryRelay, method: string, path: string, host = `127.0.0.1:${relay.port}`) {
	return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: relay.port, method, path, headers: { host } }, (res: IncomingMessage) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
			res.on("error", reject);
		});
		req.on("error", reject);
		req.end();
	});
}

test("a packument's tarballs on the registry point at the relay, as the remote reaches it", async (t) => {
	const registry = await fakeRegistry(t);
	const relay = await relayFor(t, registry.origin);

	const answer = await send(relay, "GET", "/left-pad", "127.0.0.1:41234");

	assert.equal(answer.status, 200);
	const versions = JSON.parse(answer.body.toString()).versions;
	assert.equal(versions["1.0.0"].dist.tarball, "http://127.0.0.1:41234/left-pad/-/left-pad-1.0.0.tgz");
	assert.equal(versions["1.0.0"].dist.integrity, "sha512-x");
	// Not the registry's: left as it is, and the relay would not fetch it.
	assert.equal(versions["0.9.0"].dist.tarball, "https://elsewhere.example/left-pad-0.9.0.tgz");
	assert.ok(!answer.body.toString().includes(registry.origin));
});

test("scoped names and tarballs pass through; a missing package stays a 404", async (t) => {
	const registry = await fakeRegistry(t);
	const relay = await relayFor(t, registry.origin);

	assert.equal((await send(relay, "GET", "/@dev.fast%2fdiffr")).status, 200);
	const tarball = await send(relay, "GET", "/left-pad/-/left-pad-1.0.0.tgz");
	assert.equal(tarball.status, 200);
	assert.ok(tarball.body.equals(registry.tarball));
	assert.equal((await send(relay, "GET", "/no-such-package")).status, 404);
	assert.deepEqual(registry.seen, ["GET /@dev.fast%2fdiffr", "GET /left-pad/-/left-pad-1.0.0.tgz", "GET /no-such-package"]);
});

test("only GET of a package or a tarball, from a loopback Host, reaches the registry", async (t) => {
	const registry = await fakeRegistry(t);
	const relay = await relayFor(t, registry.origin);

	assert.equal((await send(relay, "POST", "/left-pad")).status, 405);
	assert.equal((await send(relay, "HEAD", "/left-pad")).status, 405);
	assert.equal((await send(relay, "PUT", "/left-pad")).status, 405);
	for (const path of ["/", "/..", "/@x/..", "/../etc/passwd", "//elsewhere.example/x", "/left-pad?write=1", "/-/npm/v1/security/advisories/bulk", "/left-pad/1.0.0", "/%2e%2e/x", "/a/b/c"]) {
		assert.equal((await send(relay, "GET", path)).status, 404, path);
	}
	assert.equal((await send(relay, "GET", "/left-pad", "elsewhere.example")).status, 400);
	assert.deepEqual(registry.seen, []);
});

test("a tarball over the size bound is cut off", async (t) => {
	const registry = await fakeRegistry(t);
	const relay = await relayFor(t, registry.origin, { tarball: 100_000 });

	assert.equal((await send(relay, "GET", "/left-pad/-/left-pad-1.0.0.tgz")).status, 502);
});

test("closing the relay stops it listening", async (t) => {
	const registry = await fakeRegistry(t);
	const relay = await startRegistryRelay({ upstream: registry.origin });
	await relay.close();

	await assert.rejects(send(relay, "GET", "/left-pad"), /ECONNREFUSED/);
});
