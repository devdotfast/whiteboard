import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { MarkerService } from "../../../../platform/markers/common/markerService.js";
import { type IMarkerData, MarkerSeverity } from "../../../../platform/markers/common/markers.js";
import { reviewRemoteDiagnostics } from "./reviewRemoteDiagnostics.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);

test("a host's diagnostics keep web code links and own related locations only; each kind logged once", () => {
	const warnings: string[] = [];
	const markers = new MarkerService();
	const diagnostics = reviewRemoteDiagnostics(markers, new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService));
	const marker = (code: IMarkerData["code"], related: URI[] = []): IMarkerData => ({
		message: "m", severity: MarkerSeverity.Error, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2, code,
		relatedInformation: related.map((resource) => ({ resource, message: "r", startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 })),
	});
	diagnostics.changeOne("probe", own, [
		marker({ value: "E1", target: URI.parse("command:vscode.openFolder?%5B%22file%3A%2F%2F%2F%22%5D") }),
		marker({ value: "E2", target: URI.parse("https://example.com/E2") }, [own, URI.file("/Users/me/secret.txt")]),
		marker({ value: "E3", target: URI.file("/etc/hosts") }),
	]);
	const read = markers.read({ owner: "probe" });
	assert.deepEqual(read.map((m) => (typeof m.code === "string" ? m.code : m.code?.target.toString())), ["E1", "https://example.com/E2", "E3"]);
	assert.deepEqual(read[1].relatedInformation?.map((info) => info.resource.toString()), [own.toString()]);
	assert.deepEqual(warnings, [
		`[Remote guard] ${A}: refused diagnostic links other than http and https`,
		`[Remote guard] ${A}: refused diagnostic locations outside this remote`,
	]);
});
