import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { ReviewRemoteEditSessionIdentityService } from "./reviewRemoteEditSessionIdentityService.js";

test("an edit session identity provider is refused, logged once, and nothing is answered", async () => {
	const { warnings, refusals: r } = refusals();
	const service = new ReviewRemoteEditSessionIdentityService(r);
	assert.throws(() => service.registerEditSessionIdentityProvider(), /^Error: Not available for an extension on wb-test-a: providing edit session identities to the window\.$/);
	assert.throws(() => service.addEditSessionIdentityCreateParticipant(), /providing edit session identities/);
	assert.equal(await service.getEditSessionIdentifier(), undefined);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused providing edit session identities to the window`]);
});
