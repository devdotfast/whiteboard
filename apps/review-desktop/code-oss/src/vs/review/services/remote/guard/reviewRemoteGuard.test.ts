import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const refusals = new ReviewRemoteRefusals("whiteboard+aaaa-1111", () => "wb-test-a", { warn() { } } as unknown as ILogService);

test("only literal http, https and mailto link targets survive in text a remote shows", () => {
	const cases: [string, string][] = [
		["[a](https://x.dev/p) [m](mailto:me@x.dev)", "[a](https://x.dev/p) [m](mailto:me@x.dev)"],
		["[a](command:x)", "[a]"],
		["[a [b]](command:x)", "[a [b]]"],
		["[a](<command:x> \"title\")", "[a]"],
		["[a](\n  file:///etc/hosts )", "[a]"],
		["[a](&#99;ommand:x)", "[a]"],
		["[a](vscode://settings)", "[a]"],
		["<command:x> <https://x.dev>", "command:x <https://x.dev>"],
		["[a][r]\n[r]: command:x \"t\"", "[a][r]\n"],
	];
	for (const [input, expected] of cases) assert.equal(refusals.text(input), expected, input);
});

test("remote markdown is untrusted and has no HTML", () => {
	assert.deepEqual(refusals.markdown({ value: "[a](command:x)", isTrusted: true, supportHtml: true, supportThemeIcons: true }), {
		value: "[a]",
		isTrusted: false,
		supportHtml: false,
		supportThemeIcons: true,
	});
});
