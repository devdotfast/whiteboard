import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import type { ILabelService } from "../../../../platform/label/common/label.js";
import { reviewRemoteLabelService } from "./reviewRemoteLabelService.js";

test("labels are read from the window, and formatters are refused, logged once", () => {
	const { warnings, refusals: r } = refusals();
	const registered: unknown[] = [];
	const labels = reviewRemoteLabelService({ getUriLabel: () => "wb-test-a: /x", registerFormatter: (f: unknown) => registered.push(f) } as unknown as ILabelService, r);
	assert.equal(labels.getUriLabel(null as never), "wb-test-a: /x");
	const formatter = { scheme: "file", formatting: { label: "evil ${path}", separator: "/" as const } };
	assert.throws(() => labels.registerFormatter(formatter), /^Error: Not available for an extension on wb-test-a: changing how the window labels files\.$/);
	assert.throws(() => labels.registerCachedFormatter(formatter), /changing how the window labels files/);
	assert.deepEqual(registered, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused changing how the window labels files`]);
});
