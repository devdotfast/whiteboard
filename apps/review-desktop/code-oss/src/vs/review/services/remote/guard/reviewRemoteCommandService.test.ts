import assert from "node:assert/strict";
import test from "node:test";
import { DisposableStore } from "../../../../base/common/lifecycle.js";
import { CommandsRegistry, ICommandService } from "../../../../platform/commands/common/commands.js";
import { SyncDescriptor } from "../../../../platform/instantiation/common/descriptors.js";
import { createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { ReviewRemoteCommands, ReviewRemoteCommandService, reviewRemoteRelayCommand } from "./reviewRemoteCommandService.js";
import { IReviewRemoteRefusals, ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";
const refused = /^Error: Not available for an extension on wb-test-\w: /;
const IWhere = createDecorator<{ readonly _serviceBrand: undefined; name: string }>("reviewRemoteCommandTestWhere");

function windowCommands(t: { after(fn: () => void): void }) {
	const ran: string[] = [];
	const store = new DisposableStore();
	t.after(() => store.dispose());
	for (const id of ["_executeHoverProvider", "setContext", "vscode.openFolder", "workbench.action.openSettings", "_workbench.open"]) {
		store.add(CommandsRegistry.registerCommand(id, (accessor) => {
			ran.push(`${id} in ${accessor.get(IWhere).name}`);
			return "the window's";
		}));
	}
	return { ran, store };
}

function host(t: { after(fn: () => void): void }, store: DisposableStore, authority: string) {
	const warnings: string[] = [];
	const refusals = new ReviewRemoteRefusals(authority, () => `wb-test-${authority[11]}`, { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const scope = new InstantiationService(new ServiceCollection(
		[IWhere, { name: `${authority}'s scope` }],
		[IReviewRemoteRefusals, refusals],
		[ICommandService, new SyncDescriptor(ReviewRemoteCommandService)],
	), true);
	t.after(() => scope.dispose());
	const executed: unknown[][] = [];
	const context = { getProxy: () => ({ $executeContributedCommand: async (...args: unknown[]) => executed.push(args) && `${authority}'s` }) } as unknown as IExtHostContext;
	const actor = store.add(scope.createInstance(ReviewRemoteCommands, context));
	return { actor, commands: scope.invokeFunction((accessor) => accessor.get(ICommandService)) as ReviewRemoteCommandService, warnings, executed };
}

test("a listed command runs with the host's own services; setContext succeeds and does nothing", async (t) => {
	const { ran, store } = windowCommands(t);
	const { actor } = host(t, store, A);
	assert.equal(await actor.$executeCommand("_executeHoverProvider", []), "the window's");
	assert.equal(await actor.$executeCommand("setContext", ["typescript.isManagedFile", true]), undefined);
	assert.deepEqual(ran, [`_executeHoverProvider in ${A}'s scope`]);
});

test("the window's other commands are refused, whoever asks, and logged once", async (t) => {
	const { ran, store } = windowCommands(t);
	const { actor, commands, warnings } = host(t, store, A);
	for (const id of ["vscode.openFolder", "workbench.action.openSettings", "_workbench.open", "_executeDocumentSymbolProvider", "no.such.command"]) {
		await assert.rejects(actor.$executeCommand(id, ["file:///tmp"]), refused, id);
		await assert.rejects(commands.executeCommand(id), refused, id);
	}
	assert.deepEqual(ran, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused running window commands`]);
});

test("a host's own commands stay out of the window's registry, and a window command cannot be replaced", async (t) => {
	const { ran, store } = windowCommands(t);
	const { actor, warnings, executed } = host(t, store, A);
	actor.$registerCommand("wbProbe.hello");
	assert.equal(CommandsRegistry.getCommand("wbProbe.hello"), undefined);
	assert.equal(await actor.$executeCommand("wbProbe.hello", [1]), `${A}'s`);
	assert.deepEqual(executed, [["wbProbe.hello", 1]]);
	assert.deepEqual((await actor.$getCommands()).sort(), ["_executeHoverProvider", "setContext", "wbProbe.hello"]);

	assert.throws(() => actor.$registerCommand("workbench.action.openSettings"), refused);
	assert.equal(await CommandsRegistry.getCommand("workbench.action.openSettings")?.handler({ get: () => ({ name: "the window" }) } as never), "the window's");
	assert.deepEqual(ran, ["workbench.action.openSettings in the window"]);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused replacing a window command`]);

	actor.$unregisterCommand("wbProbe.hello");
	await assert.rejects(actor.$executeCommand("wbProbe.hello", []), refused);
});

test("two hosts registering the same command id each run their own", async (t) => {
	const { store } = windowCommands(t);
	const a = host(t, store, A);
	const b = host(t, store, B);
	a.actor.$registerCommand("typescript.restartTsServer");
	b.actor.$registerCommand("typescript.restartTsServer");
	assert.equal(await a.actor.$executeCommand("typescript.restartTsServer", []), `${A}'s`);
	assert.equal(await b.actor.$executeCommand("typescript.restartTsServer", []), `${B}'s`);
	assert.deepEqual([a.warnings, b.warnings], [[], []]);
});

test("a host's relay command runs its own commands and the list, and refuses the rest", async (t) => {
	const { ran, store } = windowCommands(t);
	const { actor, commands } = host(t, store, A);
	actor.$registerCommand("wbProbe.hello");
	const relayed = commands.relay({ id: "vscode.openFolder", title: "Open", arguments: ["file:///Users/me"] });
	assert.deepEqual(relayed, { id: reviewRemoteRelayCommand(A), title: "Open", arguments: ["vscode.openFolder", "file:///Users/me"] });
	const relay = CommandsRegistry.getCommand(reviewRemoteRelayCommand(A))!.handler;
	await assert.rejects(Promise.resolve(relay({} as never, ...relayed.arguments!)), refused);
	assert.equal(await relay({} as never, "wbProbe.hello"), `${A}'s`);
	assert.deepEqual(ran, []);
});
