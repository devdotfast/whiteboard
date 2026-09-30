import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IOpenerService } from "../../../../platform/opener/common/opener.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { reviewRemoteOpenerService } from "./reviewRemoteOpenerService.js";

const A = "whiteboard+aaaa-1111";
const refused = /^Error: Not available for an extension on wb-test-a: /;

function setup() {
	const warnings: string[] = [];
	const opened: unknown[] = [];
	const base = {
		open: async (target: URI | string, options: unknown) => {
			opened.push([String(target), options]);
			return true;
		},
		resolveExternalUri: async (resource: URI) => ({ resolved: resource, dispose() { } }),
		registerOpener: () => opened.push("registerOpener"),
	} as unknown as IOpenerService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	return { opener: reviewRemoteOpenerService(base, refusals), opened, warnings };
}

test("web and mail links go to the window's opener, without command links or skipped validation", async () => {
	const { opener, opened } = setup();
	assert.equal(await opener.open("https://example.com/a", { allowCommands: true, skipValidation: true, allowContributedOpeners: true }), true);
	assert.equal(await opener.open(URI.parse("http://example.com/b")), true);
	assert.equal(await opener.open("mailto:dev@example.com"), true);
	assert.equal((await opener.resolveExternalUri(URI.parse("http://localhost:3000"))).resolved.toString(), "http://localhost:3000/");
	assert.deepEqual(opened, [
		["https://example.com/a", { openExternal: true }],
		["http://example.com/b", { openExternal: true }],
		["mailto:dev@example.com", { openExternal: true }],
	]);
});

test("files, apps, commands and other schemes are refused, logged once", async () => {
	const { opener, opened, warnings } = setup();
	for (const target of [
		URI.file("/System/Applications/Calculator.app"),
		"file:///tmp/x.command",
		"command:workbench.action.openSettings",
		URI.parse("vscode-remote://whiteboard+aaaa-1111/tmp/x"),
		"ssh://host",
		"vscode://settings",
		"javascript:alert(1)",
	]) await assert.rejects(opener.open(target), refused, String(target));
	await assert.rejects(opener.resolveExternalUri(URI.file("/etc/hosts")), refused);
	assert.throws(() => opener.registerOpener({ open: async () => true }), refused);
	assert.deepEqual(opened, []);
	assert.deepEqual(warnings, [
		`[Remote guard] ${A}: refused opening links other than http, https and mailto`,
		`[Remote guard] ${A}: refused changing how the window opens links`,
	]);
});
