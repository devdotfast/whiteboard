/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from "child_process";
import type { IProcessEnvironment } from "../../base/common/platform.js";
import { removeDangerousEnvVariables, sanitizeProcessEnvironment } from "../../base/common/processes.js";

/**
 * The environment an editor gets when Whiteboard starts it.
 *
 * An app launched to handle a URL inherits the environment of the process
 * that asked for it, and the editors are Code-OSS builds too: `VSCODE_DEV`
 * from a dev build makes them load from sources, and a packaged build still
 * carries runtime values such as `VSCODE_CWD`. This drops everything
 * Electron, Code-OSS and Whiteboard set, as upstream does for external
 * terminals, and keeps the reader's own variables such as `PATH`.
 */
export function externalEditorEnvironment(source: IProcessEnvironment): IProcessEnvironment {
	const env = { ...source };
	sanitizeProcessEnvironment(env);
	removeDangerousEnvVariables(env);
	for (const key of Object.keys(env)) {
		if (/^(VSCODE_|DEV_FAST_REVIEW_|DEV_REVIEW_)/i.test(key) || key === "NODE_ENV") delete env[key];
	}
	return env;
}

function urlOpener(platform: NodeJS.Platform, url: string): [string, string[]] {
	if (platform === "darwin") return ["/usr/bin/open", [url]];
	if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
}

export interface ExternalEditorLaunchOptions {
	readonly spawn?: typeof cp.spawn;
	readonly platform?: NodeJS.Platform;
	readonly env?: IProcessEnvironment;
	/** How long to wait for the opener to report a failure before leaving it running. */
	readonly settleMs?: number;
}

/**
 * Opens an editor URL through the platform opener rather than
 * `shell.openExternal`, which offers no way to choose the environment.
 * `open` returns once the handler has the URL; an opener still running after
 * `settleMs` is left detached, as some `xdg-open` handlers stay in the
 * foreground.
 */
export function launchExternalEditorUrl(url: string, options: ExternalEditorLaunchOptions = {}): Promise<void> {
	const { spawn = cp.spawn, platform = process.platform, env = process.env, settleMs = 5_000 } = options;
	const [command, args] = urlOpener(platform, url);
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { env: externalEditorEnvironment(env), detached: true, stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
		const timer = setTimeout(() => { child.unref(); resolve(); }, settleMs);
		child.on("error", (error) => { clearTimeout(timer); reject(error); });
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
		});
	});
}
