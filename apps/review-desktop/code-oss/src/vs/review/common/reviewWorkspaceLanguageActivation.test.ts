import assert from "node:assert/strict";
import test from "node:test";
import { ImplicitActivationEvents } from "../../platform/extensionManagement/common/implicitActivationEvents.js";
import { ExtensionHostExtensions } from "../../workbench/services/extensions/common/extensions.js";
import { ExtensionIdentifier, type IExtensionDescription } from "../../platform/extensions/common/extensions.js";
import {
	ReviewWorkspaceHostExtensions,
	reviewWorkspaceLanguageEvent,
	rewriteReviewActivationEvents,
} from "./reviewWorkspaceLanguageActivation.js";
const extension = (id: string) => ({ identifier: new ExtensionIdentifier(id) });

test("backing models and startup events cannot activate workspace clients in the shared window", () => {
	for (const [id, language] of [
		["Rust-Lang.Rust-Analyzer", "rust"],
		["FWCD.Kotlin", "kotlin"],
		["ms-python.python", "python"],
		["golang.go", "go"],
	]) {
		const events = rewriteReviewActivationEvents(extension(id), [
			`onLanguage:${language}`,
			"onStartupFinished",
			"workspaceContains:project",
			"onCommand:server.status",
		]);
		assert.ok(
			!events.some(
				(event) => event.startsWith("onLanguage:") || event === "onStartupFinished" || event.startsWith("workspaceContains:"),
			),
		);
		assert.ok(events.includes(reviewWorkspaceLanguageEvent(language)));
	}
});
test("keymaps keep their window activation", () => {
	const events = ["*", "onStartupFinished"];
	assert.equal(rewriteReviewActivationEvents(extension("vscodevim.vim"), events), events);
});

test("embedded workspaces restore language, command, startup and workspace activation", () => {
	ImplicitActivationEvents.setRewrite(rewriteReviewActivationEvents);
	try {
		const events = ["onLanguage:kotlin", "onCommand:kotlin.restart", "*", "onStartupFinished", "workspaceContains:*.kt"];
		const desc = { ...extension("fwcd.kotlin"), main: "./extension.js", activationEvents: events } as unknown as IExtensionDescription;
		const window = new ExtensionHostExtensions(1, [desc], [desc.identifier]);
		const snapshot = new ReviewWorkspaceHostExtensions(1, [desc], [desc.identifier]);
		for (const event of events) {
			assert.equal(window.containsActivationEvent(event), false, `window cannot activate ${event}`);
			assert.equal(snapshot.containsActivationEvent(event), true, `snapshot can activate ${event}`);
		}
		assert.deepEqual(snapshot.toSnapshot().activationEvents["fwcd.kotlin"], events);
		assert.ok(!window.toSnapshot().activationEvents["fwcd.kotlin"].includes("onStartupFinished"));
	} finally {
		ImplicitActivationEvents.setRewrite(undefined);
	}
});
