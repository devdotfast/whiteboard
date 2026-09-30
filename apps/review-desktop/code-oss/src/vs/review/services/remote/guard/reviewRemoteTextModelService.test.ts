import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { ITextModelService } from "../../../../editor/common/services/resolverService.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { reviewRemoteTextModelService } from "./reviewRemoteTextModelService.js";

const A = "whiteboard+aaaa-1111";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);
const refused = /^Error: Not available for an extension on wb-test-a: /;

function setup() {
	const warnings: string[] = [];
	const opened: string[] = [];
	const base = {
		createModelReference: async (resource: URI) => {
			opened.push(resource.toString());
			return { object: {}, dispose() { } };
		},
		canHandleResource: () => true,
		registerTextModelContentProvider: () => opened.push("provider"),
	} as unknown as ITextModelService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	return { models: reviewRemoteTextModelService(base, refusals), opened, warnings };
}

test("a host opens a document of its own", async () => {
	const { models, opened } = setup();
	await models.createModelReference(own);
	assert.equal(models.canHandleResource(own), true);
	assert.deepEqual(opened, [own.toString()]);
});

test("laptop, profile, untitled and other hosts' documents are refused, logged once", async () => {
	const { models, opened, warnings } = setup();
	for (const uri of [
		URI.file("/etc/hosts"),
		URI.parse("vscode-userdata:/Users/me/settings.json"),
		URI.parse("untitled:Untitled-1"),
		URI.parse("vscode-remote://whiteboard+bbbb-2222/home/dev/proj/a.ts"),
	]) {
		await assert.rejects(models.createModelReference(uri), refused, uri.toString());
		assert.equal(models.canHandleResource(uri), false);
	}
	assert.throws(() => models.registerTextModelContentProvider("git", {} as never), refused);
	assert.deepEqual(opened, []);
	assert.deepEqual(warnings, [
		`[Remote guard] ${A}: refused opening documents outside this remote`,
		`[Remote guard] ${A}: refused registering a document content provider`,
	]);
});
