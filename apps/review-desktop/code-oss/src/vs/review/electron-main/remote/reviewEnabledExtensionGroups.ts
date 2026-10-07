/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewOptionalExtensionCatalog } from "../../node/reviewOptionalExtensionCatalog.js";

export async function reviewEnabledExtensionGroups(extensionsPath: string): Promise<string[]> {
	const read = (name: string) => readFile(join(extensionsPath, name), "utf8").then(JSON.parse).catch(() => undefined) as Promise<unknown>;
	const [list, obsolete] = await Promise.all([read("extensions.json"), read(".obsolete")]);
	if (!Array.isArray(list)) return [];
	const removed = obsolete && typeof obsolete === "object" ? (obsolete as Record<string, unknown>) : {};
	const installed = new Set<string>();
	for (const entry of list as { identifier?: { id?: unknown }; relativeLocation?: unknown }[]) {
		const id = entry?.identifier?.id;
		if (typeof id !== "string") continue;
		if (typeof entry.relativeLocation === "string" && removed[entry.relativeLocation] === true) continue;
		installed.add(id.toLowerCase());
	}
	return [
		...new Set(
			reviewOptionalExtensionCatalog
				.filter((extension) => extension.role === "primary" && installed.has(extension.id.toLowerCase()))
				.map((extension) => extension.group),
		),
	];
}
