import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const LINK = "run [this](command:vscode.openFolder?%5B%22file%3A%2F%2F%2FUsers%22%5D) or read [docs](https://example.com)";
const CLEAN = "run [this] or read [docs](https://example.com)";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import Severity from "../../../../base/common/severity.js";
import type { INotificationService } from "../../../../platform/notification/common/notification.js";
import { reviewRemoteNotificationService } from "./reviewRemoteNotificationService.js";

test("a notification from a remote keeps its web links and loses the rest; logged once", () => {
	const { warnings, refusals: r } = refusals();
	const shown: unknown[] = [];
	const base = {
		notify: (n: { message: unknown }) => shown.push(n.message),
		prompt: (_s: Severity, message: string) => shown.push(message),
		error: (message: unknown) => shown.push(message),
	} as unknown as INotificationService;
	const notifications = reviewRemoteNotificationService(base, r);
	notifications.notify({ severity: Severity.Info, message: LINK });
	notifications.prompt(Severity.Warning, LINK, []);
	notifications.error([LINK, "plain"]);
	notifications.notify({ severity: Severity.Info, message: "no links, [ref]\n\n[ref]: command:workbench.action.openSettings" });
	assert.deepEqual(shown, [CLEAN, CLEAN, [CLEAN, "plain"], "no links, [ref]\n\n"]);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused links other than http, https and mailto in text a remote shows`]);
});
