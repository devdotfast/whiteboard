import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { ReviewRemoteCanonicalUriService } from "./reviewRemoteCanonicalUriService.js";

test("a canonical URI provider is refused, logged once", () => {
	const { warnings, refusals: r } = refusals();
	const service = new ReviewRemoteCanonicalUriService(r);
	for (let i = 0; i < 2; i++) assert.throws(() => service.registerCanonicalUriProvider(), /^Error: Not available for an extension on wb-test-a: providing canonical URIs to the window\.$/);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused providing canonical URIs to the window`]);
});
