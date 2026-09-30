/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { glob, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/**
 * The `Host` aliases of an ssh_config, in file order, each once, for display
 * only. Patterns with `*`, `?` or `!` are not aliases. Connecting leaves the
 * configuration to OpenSSH.
 */
export async function listSshAliases(configPath: string): Promise<string[]> {
	const aliases = new Set<string>();
	await readConfig(configPath, dirname(configPath), new Set(), aliases);
	return [...aliases];
}

/** Reads each file once: a later read adds no alias, and a cyclic `Include` ends. */
async function readConfig(file: string, includeDir: string, read: Set<string>, aliases: Set<string>): Promise<void> {
	if (read.has(file)) return;
	read.add(file);
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch {
		return;
	}
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*(\w+)(?:\s*=\s*|\s+)(.*)$/.exec(line);
		if (!match) continue;
		const keyword = match[1].toLowerCase();
		const words = argumentsOf(match[2]);
		if (keyword === "host") {
			for (const word of words) if (!/[*?!]/.test(word)) aliases.add(word);
		} else if (keyword === "include") {
			for (const word of words) {
				for (const included of await expand(word, includeDir)) {
					await readConfig(included, includeDir, read, aliases);
				}
			}
		}
	}
}

/** Whitespace-separated, double quotes group, `#` starts a comment. */
function argumentsOf(rest: string): string[] {
	const words: string[] = [];
	for (const [, quoted, bare] of rest.matchAll(/"([^"]*)"|(\S+)/g)) {
		if (bare?.startsWith("#")) break;
		words.push(quoted ?? bare);
	}
	return words;
}

async function expand(pattern: string, includeDir: string): Promise<string[]> {
	const path = pattern.startsWith("~/") ? join(homedir(), pattern.slice(2)) : isAbsolute(pattern) ? pattern : join(includeDir, pattern);
	const files: string[] = [];
	try {
		for await (const file of glob(path)) files.push(file);
	} catch {
		return [];
	}
	return files.sort();
}
