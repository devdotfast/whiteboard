import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { URI } from "../../../../base/common/uri.js";
import type { IWorkspaceTrustRequestService } from "../../../../platform/workspace/common/workspaceTrust.js";
import { reviewRemoteWorkspaceTrustRequestService } from "./reviewRemoteWorkspaceTrustRequestService.js";

test("trust requests never reach the user, logged once", () => {
	const { warnings, refusals: r } = refusals();
	const asked: unknown[] = [];
	const trust = reviewRemoteWorkspaceTrustRequestService({ requestWorkspaceTrust: async () => asked.push("workspace") } as unknown as IWorkspaceTrustRequestService, r);
	assert.throws(() => trust.requestWorkspaceTrust({ message: "trust me" }), /^Error: Not available for an extension on wb-test-a: asking for trust in the window\.$/);
	assert.throws(() => trust.requestResourcesTrust({ uri: URI.file("/Users/me") }), /asking for trust in the window/);
	assert.deepEqual(asked, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused asking for trust in the window`]);
});
