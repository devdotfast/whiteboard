import assert from "node:assert/strict";
import test from "node:test";
import { DisposableStore } from "../../../../base/common/lifecycle.js";
import { CommandsRegistry, ICommandService } from "../../../../platform/commands/common/commands.js";
import { createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection.js";
import { SyncDescriptor } from "../../../../platform/instantiation/common/descriptors.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { ReviewRemoteCommands, ReviewRemoteCommandService } from "./reviewRemoteCommandService.js";
import { IReviewRemoteRefusals, ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const refused = /^Error: Not available for an extension on wb-test-a: /;
const IWhere = createDecorator<{ readonly _serviceBrand: undefined; name: string }>("reviewRemoteCommandTestWhere");

function setup(t: { after(fn: () => void): void }) {
	const warnings: string[] = [];
	const ran: string[] = [];
	const store = new DisposableStore();
	t.after(() => store.dispose());
	const window = (id: string) => store.add(CommandsRegistry.registerCommand(id, (accessor) => {
		ran.push(`${id} in ${accessor.get(IWhere).name}`);
		return "the window's";
	}));
	for (const id of ["_executeHoverProvider", "setContext", "vscode.openFolder", "workbench.action.openSettings", "_workbench.open"]) window(id);
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const scope = new InstantiationService(new ServiceCollection(
		[IWhere, { name: "the host's scope" }],
		[IReviewRemoteRefusals, refusals],
		[ICommandService, new SyncDescriptor(ReviewRemoteCommandService)],
	), true);
	const executed: unknown[][] = [];
	const context = { getProxy: () => ({ $executeContributedCommand: async (...args: unknown[]) => executed.push(args) && "the host's" }) } as unknown as IExtHostContext;
	const actor = scope.createInstance(ReviewRemoteCommands, context);
	store.add(actor);
	return { actor, commands: scope.invokeFunction((accessor) => accessor.get(ICommandService)), ran, warnings, executed };
}

test("a listed command runs with the host's own services; setContext succeeds and does nothing", async (t) => {
	const { actor, ran } = setup(t);
	assert.equal(await actor.$executeCommand("_executeHoverProvider", []), "the window's");
	assert.equal(await actor.$executeCommand("setContext", ["typescript.isManagedFile", true]), undefined);
	assert.deepEqual(ran, ["_executeHoverProvider in the host's scope"]);
});

test("the window's other commands are refused, whoever asks, and logged once", async (t) => {
	const { actor, commands, ran, warnings } = setup(t);
	for (const id of ["vscode.openFolder", "workbench.action.openSettings", "_workbench.open", "no.such.command"]) {
		await assert.rejects(actor.$executeCommand(id, ["file:///tmp"]), refused, id);
		await assert.rejects(commands.executeCommand(id), refused, id);
	}
	assert.deepEqual(ran, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused running window commands`]);
});

test("a host registers and runs new commands of its own, but cannot replace one of the window's", async (t) => {
	const { actor, ran, warnings, executed } = setup(t);
	actor.$registerCommand("wbProbe.hello");
	assert.equal(await actor.$executeCommand("wbProbe.hello", [1]), "the host's");
	assert.deepEqual(executed, [["wbProbe.hello", 1]]);
	assert.deepEqual((await actor.$getCommands()).sort(), ["_executeHoverProvider", "setContext", "wbProbe.hello"]);

	assert.throws(() => actor.$registerCommand("workbench.action.openSettings"), refused);
	assert.throws(() => actor.$registerCommand("wbProbe.hello"), refused);
	assert.equal(await CommandsRegistry.getCommand("workbench.action.openSettings")?.handler({ get: () => ({ name: "the window" }) } as never), "the window's");
	assert.deepEqual(ran, ["workbench.action.openSettings in the window"]);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused replacing a window command`]);

	actor.$unregisterCommand("wbProbe.hello");
	assert.equal(CommandsRegistry.getCommand("wbProbe.hello"), undefined);
	await assert.rejects(actor.$executeCommand("wbProbe.hello", []), refused);
});
