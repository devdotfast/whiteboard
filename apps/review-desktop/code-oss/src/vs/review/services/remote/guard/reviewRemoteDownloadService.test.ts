import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { IDownloadService } from "../../../../platform/download/common/download.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteDownloadService } from "./reviewRemoteDownloadService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

test("a download is refused wherever it would go, logged once", async () => {
	const warnings: string[] = [];
	const downloads: IDownloadService = new ReviewRemoteDownloadService(new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService));
	await assert.rejects(downloads.download(URI.parse("https://example.com/"), URI.file("/Users/me/.zshrc"), "test"), /^Error: Not available for an extension on wb-test-a: downloading\.$/);
	await assert.rejects(downloads.download(URI.parse("https://example.com/"), URI.parse(`vscode-remote://${A}/tmp/x`), "test"), /downloading/);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused downloading`]);
});
