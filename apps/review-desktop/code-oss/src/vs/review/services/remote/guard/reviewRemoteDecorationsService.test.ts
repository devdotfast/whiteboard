import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Emitter } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import type { IDecorationsProvider, IDecorationsService } from "../../../../workbench/services/decorations/common/decorations.js";
import { reviewRemoteDecorationsService } from "./reviewRemoteDecorationsService.js";

test("a host's decoration provider is asked about its own files only, and signals changes of its own files only", async () => {
	const { refusals: r } = refusals();
	let registered: IDecorationsProvider | undefined;
	const decorations = reviewRemoteDecorationsService({ registerDecorationsProvider: (p: IDecorationsProvider) => { registered = p; return { dispose() { } }; } } as unknown as IDecorationsService, r);
	const asked: string[] = [];
	const changes = new Emitter<URI[]>();
	decorations.registerDecorationsProvider({ label: "probe", onDidChange: changes.event, provideDecorations: (uri) => { asked.push(uri.toString()); return { letter: "P" }; } });
	const own = URI.parse(`vscode-remote://${A}/tmp/a.ts`);
	assert.deepEqual(await registered!.provideDecorations(own, CancellationToken.None), { letter: "P" });
	assert.equal(await registered!.provideDecorations(URI.file("/Users/me/secret.txt"), CancellationToken.None), undefined);
	assert.equal(await registered!.provideDecorations(URI.parse("vscode-remote://whiteboard+bbbb-2222/tmp/a.ts"), CancellationToken.None), undefined);
	assert.deepEqual(asked, [own.toString()]);
	const seen: string[][] = [];
	registered!.onDidChange((resources) => seen.push(resources.map(String)));
	changes.fire([URI.file("/Users/me/x")]);
	changes.fire([own, URI.file("/Users/me/y")]);
	assert.deepEqual(seen, [[own.toString()]]);
});
