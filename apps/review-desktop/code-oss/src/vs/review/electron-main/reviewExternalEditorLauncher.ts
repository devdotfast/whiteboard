/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from "child_process";
import { existsSync } from "fs";
import { join } from "../../base/common/path.js";
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

/** macOS hands the file to an `.app` through LaunchServices; elsewhere the chosen program takes the file as its argument. */
function applicationOpener(platform: NodeJS.Platform, application: string, filePath: string): [string, string[]] {
	if (platform === "darwin") return ["/usr/bin/open", ["-a", application, filePath]];
	return [application, [filePath]];
}

/** The native picker for "Choose application…": apps on macOS, programs on Windows, any executable on Linux. */
export function applicationPickerOptions(platform: NodeJS.Platform) {
	const title = "Choose an application to open files";
	if (platform === "darwin") return { title, defaultPath: "/Applications", properties: ["openFile" as const], filters: [{ name: "Applications", extensions: ["app"] }] };
	if (platform === "win32") return { title, properties: ["openFile" as const], filters: [{ name: "Programs", extensions: ["exe"] }] };
	return { title, defaultPath: "/usr/bin", properties: ["openFile" as const] };
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
 */
export function launchExternalEditorUrl(url: string, options: ExternalEditorLaunchOptions = {}): Promise<void> {
	return launchDetached(urlOpener(options.platform ?? process.platform, url), options);
}

/** Opens a file in an application the reader picked, with the same clean environment. */
export function launchApplication(application: string, filePath: string, options: ExternalEditorLaunchOptions = {}): Promise<void> {
	return launchDetached(applicationOpener(options.platform ?? process.platform, application, filePath), options);
}

export interface EditorWorkspaceLaunchOptions extends ExternalEditorLaunchOptions {
	/** The app bundle that handles the editor's URL scheme, which carries its command line. */
	readonly editorApplication?: (scheme: string) => Promise<string | undefined>;
	readonly exists?: (path: string) => boolean;
}

/** Each editor's command line inside its macOS app, and how it takes a folder and a file at a position. */
const EDITOR_COMMAND_LINES: Readonly<Record<string, { scheme: string; path: string[]; args: (folder: string, file: string) => string[] }>> = {
	vscode: { scheme: "vscode", path: ["Contents", "Resources", "app", "bin", "code"], args: (folder, file) => [folder, "--goto", file] },
	cursor: { scheme: "cursor", path: ["Contents", "Resources", "app", "bin", "cursor"], args: (folder, file) => [folder, "--goto", file] },
	zed: { scheme: "zed", path: ["Contents", "MacOS", "cli"], args: (folder, file) => [folder, file] },
};

/**
 * Opens a checkout and a file, `<path>:<line>:<column>`, in one editor window
 * through the editor's command line. Its URLs cannot: Zed opens each in a
 * window of its own, and Cursor drops a file URL that arrives while it is
 * still opening the folder's. Resolves false where the command line is not
 * found, which is anywhere but macOS: elsewhere a `zed` or `code` on `PATH`
 * may be another program, such as the ZFS event daemon on Linux.
 */
export async function launchEditorWorkspace(editor: string, folder: string, file: string, options: EditorWorkspaceLaunchOptions = {}): Promise<boolean> {
	const { editorApplication = protocolApplication, exists = existsSync } = options;
	const commandLine = Object.hasOwn(EDITOR_COMMAND_LINES, editor) ? EDITOR_COMMAND_LINES[editor] : undefined;
	if (!commandLine || (options.platform ?? process.platform) !== "darwin") return false;
	const application = await editorApplication(commandLine.scheme);
	const cli = application && join(application, ...commandLine.path);
	if (!cli || !exists(cli)) return false;
	await launchDetached([cli, commandLine.args(folder, file)], options);
	return true;
}

async function protocolApplication(scheme: string): Promise<string | undefined> {
	const { app } = await import("electron");
	return (await app.getApplicationInfoForProtocol(`${scheme}://`).catch(() => undefined))?.path || undefined;
}

/**
 * `open` returns once the handler has the URL or file; an opener or program
 * still running after `settleMs` is left detached, as some `xdg-open`
 * handlers and directly started programs stay in the foreground.
 */
function launchDetached([command, args]: [string, string[]], options: ExternalEditorLaunchOptions): Promise<void> {
	const { spawn = cp.spawn, env = process.env, settleMs = 5_000 } = options;
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
