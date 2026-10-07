/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ReviewRegistryRelay {
	readonly port: number;
	close(): Promise<void>;
}

export const REVIEW_REGISTRY = "https://registry.npmjs.org";

const LIMITS = {
	packument: 64 << 20,
	tarball: 256 << 20,
};

const UPSTREAM_TIMEOUT = 120_000;

const NAME = "[A-Za-z0-9~-][A-Za-z0-9._~-]*";
const PACKUMENT = new RegExp(`^/(?:@${NAME}(?:%2[fF]|/))?${NAME}$`);
const TARBALL = new RegExp(`^/(?:@${NAME}/)?${NAME}/-/${NAME}\\.tgz$`);
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;

export async function startRegistryRelay(
	options: { upstream?: string; limits?: Partial<typeof LIMITS> } = {},
): Promise<ReviewRegistryRelay> {
	const upstream = options.upstream ?? REVIEW_REGISTRY;
	const limits = { ...LIMITS, ...options.limits };
	const pending = new Set<AbortController>();

	const server = createServer((req, res) => {
		const abort = new AbortController();
		pending.add(abort);
		res.once("close", () => {
			abort.abort();
			pending.delete(abort);
		});
		relay(req, res, abort.signal).catch(() => (res.headersSent ? res.destroy() : reply(res, 502)));
	});

	async function relay(req: IncomingMessage, res: ServerResponse, signal: AbortSignal): Promise<void> {
		if (req.method !== "GET") return reply(res, 405);
		const path = req.url ?? "";
		const tarball = TARBALL.test(path);
		if (!tarball && !PACKUMENT.test(path)) return reply(res, 404);
		const host = req.headers.host ?? "";
		if (!LOOPBACK_HOST.test(host)) return reply(res, 400);

		const response = await fetch(`${upstream}${path}`, {
			headers: { accept: req.headers.accept ?? "application/json" },
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT)]),
		});
		const limit = tarball ? limits.tarball : limits.packument;
		if (Number(response.headers.get("content-length") ?? 0) > limit || !response.body) {
			await response.body?.cancel();
			return reply(res, 502);
		}
		const type = response.headers.get("content-type");
		if (type) res.setHeader("content-type", type);
		res.statusCode = response.status;

		if (tarball || !response.ok) {
			let size = 0;
			const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
			body.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > limit) body.destroy(new Error("over the size bound"));
			});
			return pipeline(body, res);
		}

		const text = await boundedText(response.body, limit);
		res.end(rewrite(text, `${upstream}/`, `http://${host}/`));
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});

	return {
		port: (server.address() as AddressInfo).port,
		close: () =>
			new Promise<void>((resolve) => {
				for (const abort of pending) abort.abort();
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}

function reply(res: ServerResponse, status: number): void {
	res.statusCode = status;
	res.end();
}

async function boundedText(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
		size += chunk.length;
		if (size > limit) throw new Error("over the size bound");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function rewrite(text: string, from: string, to: string): string {
	const packument = JSON.parse(text) as { versions?: Record<string, { dist?: { tarball?: unknown } }> };
	for (const version of Object.values(packument.versions ?? {})) {
		const dist = version?.dist;
		if (dist && typeof dist.tarball === "string" && dist.tarball.startsWith(from)) dist.tarball = to + dist.tarball.slice(from.length);
	}
	return JSON.stringify(packument);
}
