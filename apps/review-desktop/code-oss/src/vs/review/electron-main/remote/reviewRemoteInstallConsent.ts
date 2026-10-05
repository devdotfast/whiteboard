/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ReviewRemoteInstallAnswer = "allow" | "deny";

export interface ReviewRemoteInstallConsent {
	get(alias: string): Promise<ReviewRemoteInstallAnswer | undefined>;
	set(alias: string, answer: ReviewRemoteInstallAnswer): Promise<void>;
	attached(alias: string, serverId: string): Promise<void>;
}

interface Stored {
	servers: Record<string, { consent: ReviewRemoteInstallAnswer; alias: string }>;
	aliases: Record<string, ReviewRemoteInstallAnswer>;
}

export const reviewRemoteInstallConsentPath = (userDataPath: string) => join(userDataPath, "remote-install-consent.json");

const answer = (value: unknown): ReviewRemoteInstallAnswer | undefined => (value === "allow" || value === "deny" ? value : undefined);

export function openRemoteInstallConsent(path: string): ReviewRemoteInstallConsent {
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(run: () => Promise<T>): Promise<T> => {
		const next = queue.then(run, run);
		queue = next.catch(() => undefined);
		return next;
	};

	async function read(): Promise<Stored> {
		// No prototype: a key such as `__proto__` is a plain entry.
		const stored: Stored = { servers: Object.create(null), aliases: Object.create(null) };
		let value: { servers?: Record<string, { consent?: unknown; alias?: unknown }>; aliases?: Record<string, unknown> };
		try {
			value = JSON.parse(await readFile(path, "utf8"));
		} catch {
			return stored;
		}
		for (const [serverId, entry] of Object.entries(value?.servers ?? {})) {
			const consent = answer(entry?.consent);
			if (consent && typeof entry.alias === "string") stored.servers[serverId] = { consent, alias: entry.alias };
		}
		for (const [alias, value_] of Object.entries(value?.aliases ?? {})) {
			const consent = answer(value_);
			if (consent) stored.aliases[alias] = consent;
		}
		return stored;
	}

	async function write(stored: Stored, before: string): Promise<void> {
		if (JSON.stringify(stored) === before) return;
		await mkdir(dirname(path), { recursive: true });
		const part = `${path}.${randomBytes(4).toString("hex")}.part`;
		try {
			await writeFile(part, JSON.stringify(stored), { mode: 0o600 });
			await rename(part, path);
		} finally {
			await rm(part, { force: true });
		}
	}

	const serverOf = (stored: Stored, alias: string) => Object.entries(stored.servers).find(([, entry]) => entry.alias === alias)?.[0];

	return {
		get: (alias) =>
			serial(async () => {
				const stored = await read();
				const serverId = serverOf(stored, alias);
				return stored.aliases[alias] ?? (serverId === undefined ? undefined : stored.servers[serverId].consent);
			}),
		set: (alias, consent) =>
			serial(async () => {
				const stored = await read();
				const before = JSON.stringify(stored);
				const serverId = serverOf(stored, alias);
				if (serverId === undefined) stored.aliases[alias] = consent;
				else {
					stored.servers[serverId] = { consent, alias };
					delete stored.aliases[alias];
				}
				await write(stored, before);
			}),
		attached: (alias, serverId) =>
			serial(async () => {
				const stored = await read();
				const before = JSON.stringify(stored);
				const consent = stored.aliases[alias] ?? stored.servers[serverId]?.consent;
				if (!consent) return;
				for (const entry of Object.values(stored.servers)) if (entry.alias === alias) entry.alias = "";
				stored.servers[serverId] = { consent, alias };
				delete stored.aliases[alias];
				await write(stored, before);
			}),
	};
}
