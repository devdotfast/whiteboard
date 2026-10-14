/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { REVIEW_REMOTE_LOCK_STALE_SECONDS, REVIEW_REMOTE_VERSION, REVIEW_REMOTE_WRAPPER_MARK } from "../../common/reviewProtocol.js";

export { REVIEW_REMOTE_LOCK_STALE_SECONDS, REVIEW_REMOTE_VERSION, REVIEW_REMOTE_WRAPPER_MARK };

export const REVIEW_REMOTE_INSTALL_SAY = "WHITEBOARD-INSTALL";
export const REVIEW_REMOTE_INSTALL_MARKER = ".whiteboard-install.json";

export function shellQuote(value: string, lines = false): string {
	if ((lines ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/).test(value)) {
		throw new Error(`${JSON.stringify(value)} holds a control character.`);
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const reviewRemoteVersionDir = (root: string, version: string) => `${root}/versions/${version}`;

/** packages/review/remote/install.sh, beside the review server Desktop runs. */
export const reviewRemoteInstallScriptPath = (serverEntry: string) => join(dirname(serverEntry), "..", "..", "remote", "install.sh");

export const readRemoteInstallScript = (serverEntry: string) => readFile(reviewRemoteInstallScriptPath(serverEntry), "utf8");

/** The script as `sh -s` input, with its arguments set first. */
export const remoteInstallScriptInput = (script: string, args: readonly string[]) => `set -- ${args.map((arg) => shellQuote(arg)).join(" ")}\n${script}`;
