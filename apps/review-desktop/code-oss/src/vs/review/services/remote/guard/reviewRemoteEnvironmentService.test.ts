import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { IEnvironmentService } from "../../../../platform/environment/common/environment.js";
import { reviewRemoteEnvironmentService } from "./reviewRemoteEnvironmentService.js";

test("a host's extension host start sees no laptop dev paths, debug env or inspector port", () => {
	const window = {
		debugExtensionHost: { port: 5870, break: false, env: { SECRET: "laptop" } },
		isExtensionDevelopment: true,
		extensionDevelopmentLocationURI: [URI.file("/Users/me/ext")],
		extensionTestsLocationURI: URI.file("/Users/me/ext/test"),
		isBuilt: true,
	} as unknown as IEnvironmentService;
	const environment = reviewRemoteEnvironmentService(window);
	assert.deepEqual(environment.debugExtensionHost, { port: null, break: false });
	assert.equal(environment.isExtensionDevelopment, false);
	assert.equal(environment.extensionDevelopmentLocationURI, undefined);
	assert.equal(environment.extensionTestsLocationURI, undefined);
	assert.equal(environment.isBuilt, true);
});
