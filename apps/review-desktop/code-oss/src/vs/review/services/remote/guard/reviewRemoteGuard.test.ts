import assert from "node:assert/strict";
import test from "node:test";
import type { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { parseLinkedText } from "../../../../base/common/linkedText.js";
import * as marked from "../../../../base/common/marked/marked.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const refusals = new ReviewRemoteRefusals("whiteboard+aaaa-1111", () => "wb-test-a", { warn() { } } as unknown as ILogService);
const web = (href: string) => /^(https?|mailto):/i.test(href);
const openHosts = "command:vscode.open?%5B%22file%3A%2F%2F%2Fetc%2Fhosts%22%5D";

/** Every link form a remote could write, including the re-review's two that beat a hand-written parser. */
const HOSTILE = [
	`[open](${openHosts}#>x)`,
	`[x](${openHosts} "t"x")`,
	`[x](command:vscode.openFolder 't'x')`,
	"[a](command:x)",
	"[a [b]](command:x)",
	"[[b](command:y)](command:x)",
	"[a](<command:x> \"title\")",
	"[a](\n  file:///etc/hosts )",
	"[a](&#99;ommand:x)",
	"[a](%63ommand:x)",
	"[a]( command:x )",
	"[a](COMMAND:x)",
	"[a](FILE:///etc/hosts)",
	"[a](javascript:alert(1))",
	"[a](data:text/html,x)",
	"[a](vscode://settings)",
	"[a](file:///etc/hosts)",
	"![i](file:///etc/hosts)",
	"[x][r]\n\n[r]: command:y \"t\"",
	"[r]\n\n[r]: <file:///etc/hosts>",
	"<command:z> <file:///etc/hosts>",
	"<a href=\"command:q\">q</a> <img src=\"file:///etc/hosts\">",
	"<A HREF='COMMAND:q'>q</A>",
];

function linkedTextLinks(value: string) {
	return parseLinkedText(value).nodes.filter((node) => typeof node !== "string").map((node) => node.href);
}

function markdownParserLinks(markdown: IMarkdownString) {
	const found: string[] = [];
	marked.walkTokens(marked.lexer(markdown.value, { gfm: true }), (token) => {
		if (token.type === "link" || token.type === "image") found.push(token.href);
		if (token.type === "html") found.push(`html:${token.raw}`);
	});
	return found;
}

test("text a remote shows: the window's link parser finds no link that is not web, and web links stay", () => {
	for (const input of HOSTILE) {
		const hrefs = linkedTextLinks(refusals.text(input));
		assert.ok(hrefs.every(web), `${JSON.stringify(input)} -> ${hrefs.join(", ")}`);
	}
	assert.equal(refusals.text(`[open](${openHosts}#>x) or [docs](https://x.dev/p)`), "open or [docs](https://x.dev/p)");
	assert.equal(refusals.text(`[x](${openHosts} "t"x")`), `x`);
	assert.equal(refusals.text("plain [label] text"), "plain [label] text");
});

test("markdown a remote shows: the window's markdown parser finds no link, image or HTML that is not web", () => {
	for (const input of [...HOSTILE, "[docs](https://x.dev) and [a](command:x)"]) {
		const cleaned = refusals.markdown({ value: input, isTrusted: true, supportHtml: true });
		const found = markdownParserLinks(cleaned);
		assert.ok(found.every(web), `${JSON.stringify(input)} -> ${found.join(", ")}`);
	}
	assert.deepEqual(markdownParserLinks(refusals.markdown({ value: "[docs](https://x.dev) and [a](command:x)" })), ["https://x.dev"]);
});

test("remote markdown is rebuilt: untrusted, no HTML, no uris or baseUri", () => {
	const hostile = {
		value: "[x](https://ok.example) [y](https://also.example)",
		isTrusted: true,
		supportHtml: true,
		supportThemeIcons: true,
		baseUri: { scheme: "file", path: "/Users/me/" },
		uris: {
			"https://ok.example": { scheme: "command", path: "vscode.open", query: '["file:///etc/hosts"]' },
			"https://also.example": { scheme: "file", path: "/etc/hosts" },
		},
	} as unknown as IMarkdownString;
	assert.deepEqual(refusals.markdown(hostile), {
		value: "[x](https://ok.example) [y](https://also.example)",
		isTrusted: false,
		supportHtml: false,
		supportThemeIcons: true,
	});
	assert.deepEqual(refusals.markdown({ value: "a" }), { value: "a", isTrusted: false, supportHtml: false });
});
