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
import type { IRequestService } from "../../../../platform/request/common/request.js";
import { reviewRemoteRequestService } from "./reviewRemoteRequestService.js";

test("the laptop's proxy, credentials and certificates are never handed out; logged once", async () => {
	const { warnings, refusals: r } = refusals();
	const asked: string[] = [];
	const base = {
		resolveProxy: async () => { asked.push("proxy"); return "PROXY corp:3128"; },
		lookupAuthorization: async () => { asked.push("auth"); return { username: "me", password: "secret" }; },
		lookupKerberosAuthorization: async () => { asked.push("kerberos"); return "ticket"; },
		loadCertificates: async () => { asked.push("certs"); return ["corp-ca"]; },
	} as unknown as IRequestService;
	const requests = reviewRemoteRequestService(base, r);
	assert.equal(await requests.resolveProxy("https://example.com"), undefined);
	assert.equal(await requests.lookupAuthorization({ isProxy: true, scheme: "basic", host: "corp", port: 3128, realm: "", attempt: 1 }), undefined);
	assert.equal(await requests.lookupKerberosAuthorization("https://example.com"), undefined);
	assert.deepEqual(await requests.loadCertificates(), []);
	assert.throws(() => requests.request({ url: "https://example.com", callSite: "test" }, CancellationToken.None), /^Error: Not available for an extension on wb-test-a: using the laptop's network settings\.$/);
	assert.deepEqual(asked, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused using the laptop's network settings`]);
});
