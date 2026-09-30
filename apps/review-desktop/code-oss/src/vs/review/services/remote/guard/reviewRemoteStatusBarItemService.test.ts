import assert from "node:assert/strict";
import test from "node:test";
import { CancellationToken } from "../../../../base/common/cancellation.js";
import type { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { CommandsRegistry, ICommandService } from "../../../../platform/commands/common/commands.js";
import { SyncDescriptor } from "../../../../platform/instantiation/common/descriptors.js";
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IExtensionStatusBarItemService } from "../../../../workbench/api/browser/statusBarExtensionPoint.js";
import { ReviewRemoteCommandService, reviewRemoteRelayCommand } from "./reviewRemoteCommandService.js";
import { IReviewRemoteRefusals, ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { ReviewRemoteStatusBarItemService } from "./reviewRemoteStatusBarItemService.js";

const A = "whiteboard+aaaa-1111";

function setup(t: { after(fn: () => void): void }) {
	const warnings: string[] = [];
	const set: unknown[][] = [];
	const unset: string[] = [];
	const base = {
		setOrUpdateEntry: (...args: unknown[]) => set.push(args),
		unsetEntry: (id: string) => unset.push(id),
		getEntries: () => [["laptop.ext.item", { entry: { text: "laptop" } }]],
	} as unknown as IExtensionStatusBarItemService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const scope = new InstantiationService(new ServiceCollection(
		[IReviewRemoteRefusals, refusals],
		[ICommandService, new SyncDescriptor(ReviewRemoteCommandService)],
	), true);
	t.after(() => scope.dispose());
	const items = new ReviewRemoteStatusBarItemService(base, scope.invokeFunction((accessor) => accessor.get(ICommandService)), refusals);
	const entry = (id: string, tooltip: unknown, command: unknown) =>
		items.setOrUpdateEntry(id, "probe", "wb-test.probe", "Probe", "$(check) probe", tooltip as never, command as never, undefined, undefined, true, 0, undefined);
	return { items, entry, set, unset, warnings };
}

test("a status bar item's command runs through the host's relay, and a laptop command it names is refused", async (t) => {
	const { entry, set, warnings } = setup(t);
	entry("wb-test.probe.item", undefined, { id: "vscode.openFolder", title: "Open", arguments: ["file:///Users/me"] });
	const command = set[0][6] as { id: string; arguments: unknown[] };
	assert.deepEqual(command, { id: reviewRemoteRelayCommand(A), title: "Open", arguments: ["vscode.openFolder", "file:///Users/me"] });
	await assert.rejects(Promise.resolve(CommandsRegistry.getCommand(command.id)!.handler({} as never, ...command.arguments)), /running window commands/);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused running window commands`]);
});

test("tooltips lose their non-web links and their markdown is untrusted, including a provider's", async (t) => {
	const { entry, set } = setup(t);
	entry("wb-test.probe.a", "[go](command:vscode.openFolder?%5B%22file%3A%2F%2F%2F%22%5D) [docs](https://example.com)", undefined);
	entry("wb-test.probe.b", { value: "[x](file:///etc/hosts)", isTrusted: true, supportHtml: true }, undefined);
	entry("wb-test.probe.c", { markdown: async () => ({ value: "[y](command:x)", isTrusted: true }), markdownNotSupportedFallback: undefined }, undefined);
	assert.equal(set[0][5], "[go] [docs](https://example.com)");
	assert.deepEqual(set[1][5], { value: "[x]", isTrusted: false, supportHtml: false });
	const provided = await (set[2][5] as { markdown: (token: CancellationToken) => Promise<IMarkdownString> }).markdown(CancellationToken.None);
	assert.deepEqual(provided, { value: "[y]", isTrusted: false, supportHtml: false });
});

test("the laptop's items are neither sent to the host nor changed or removed by it", (t) => {
	const { items, entry, set, unset, warnings } = setup(t);
	assert.deepEqual([...items.getEntries()], []);
	assert.throws(() => entry("laptop.ext.item", "spoof", undefined), /changing the window's status bar items/);
	items.unsetEntry("laptop.ext.item");
	assert.deepEqual([set, unset], [[], []]);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused changing the window's status bar items`]);
});
