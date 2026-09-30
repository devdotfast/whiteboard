/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { Disposable, DisposableMap, toDisposable } from "../../../../base/common/lifecycle.js";
import { revive } from "../../../../base/common/marshalling.js";
import type { Command } from "../../../../editor/common/languages.js";
import { CommandsRegistry, ICommandService } from "../../../../platform/commands/common/commands.js";
import { IInstantiationService } from "../../../../platform/instantiation/common/instantiation.js";
import { ExtHostContext, type ExtHostCommandsShape, type MainThreadCommandsShape } from "../../../../workbench/api/common/extHost.protocol.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { SerializableObjectWithBuffers } from "../../../../workbench/services/extensions/common/proxyIdentifier.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const LANGUAGE_API = "a `vscode.execute…` API command; it runs on this host's own providers (the scope's registry and models) and opens only this host's files";

/**
 * The window's commands a remote's extensions may run, besides their own.
 * Everything else in the window is refused.
 */
export const REMOTE_WINDOW_COMMANDS: ReadonlyMap<string, string> = new Map([
	["setContext", "language extensions set context keys when they start; here those keys would change the laptop's menus, so the call succeeds and does nothing"],
	["_executeHoverProvider", LANGUAGE_API],
	["_executeDefinitionProvider", LANGUAGE_API],
	["_executeDeclarationProvider", LANGUAGE_API],
	["_executeTypeDefinitionProvider", LANGUAGE_API],
	["_executeImplementationProvider", LANGUAGE_API],
	["_executeReferenceProvider", LANGUAGE_API],
	["_executeDocumentHighlights", LANGUAGE_API],
]);

/** The window command a host's UI (a status bar item) runs; it goes through that host's guard. */
export function reviewRemoteRelayCommand(authority: string): string {
	return `_whiteboard.remoteCommand.${authority}`;
}

/**
 * Runs this host's own commands and the fixed list, with this host's
 * services: `_executeHoverProvider` asks this host's registry, not the window's.
 * A host's own commands live here, not in the window's registry, so two hosts
 * running the same extension each keep their own `typescript.*` commands, and
 * the window reaches one only through its host's relay command.
 */
export class ReviewRemoteCommandService extends Disposable implements ICommandService {
	declare readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand = Event.None;
	readonly onDidExecuteCommand = Event.None;
	private readonly own = new Map<string, (...args: unknown[]) => unknown>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals,
	) {
		super();
		this._register(CommandsRegistry.registerCommand(reviewRemoteRelayCommand(refusals.authority), (_accessor, id: unknown, ...args: unknown[]) =>
			typeof id === "string" ? this.executeCommand(id, ...args) : Promise.reject(this.refusals.refuse("running window commands"))));
	}

	/** A command this host's extensions registered, until the result is disposed. */
	addOwn(id: string, run: (...args: unknown[]) => unknown) {
		this.own.set(id, run);
		return toDisposable(() => {
			if (this.own.get(id) === run) this.own.delete(id);
		});
	}

	has(id: string): boolean {
		return this.own.has(id);
	}

	ids(): string[] {
		return [...this.own.keys(), ...[...REMOTE_WINDOW_COMMANDS.keys()].filter((id) => CommandsRegistry.getCommand(id))];
	}

	/** A command a host's UI carries, rewritten to run through this guard when the user clicks it. */
	relay(command: Command): Command {
		return { ...command, id: reviewRemoteRelayCommand(this.refusals.authority), arguments: [command.id, ...(command.arguments ?? [])] };
	}

	async executeCommand<R = unknown>(id: string, ...args: unknown[]): Promise<R | undefined> {
		const own = this.own.get(id);
		if (own) return (await own(...args)) as R;
		if (!REMOTE_WINDOW_COMMANDS.has(id)) throw this.refusals.refuse("running window commands", id);
		if (id === "setContext") return undefined;
		const command = CommandsRegistry.getCommand(id);
		if (!command) throw new Error(`command '${id}' not found`);
		return this.instantiationService.invokeFunction(command.handler, ...args) as R;
	}
}

/**
 * Takes the place of upstream's `MainThreadCommands` for a remote host, which
 * writes into the window's command registry directly: a host's commands stay
 * in its own `ReviewRemoteCommandService`, an id the window already has is
 * refused, and commands run through that service.
 */
export class ReviewRemoteCommands implements MainThreadCommandsShape {
	private readonly registrations = new DisposableMap<string>();
	private readonly proxy: ExtHostCommandsShape;
	private readonly commands: ReviewRemoteCommandService;

	constructor(
		context: IExtHostContext,
		@ICommandService commands: ICommandService,
		@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals,
	) {
		if (!(commands instanceof ReviewRemoteCommandService)) throw new Error("A remote host's scope has no guarded command service.");
		this.commands = commands;
		this.proxy = context.getProxy(ExtHostContext.ExtHostCommands);
	}

	$registerCommand(id: string): void {
		if (CommandsRegistry.getCommand(id) || this.commands.has(id)) throw this.refusals.refuse("replacing a window command", id);
		this.registrations.set(id, this.commands.addOwn(id, (...args) => this.proxy.$executeContributedCommand(id, ...args).then(revive)));
	}

	$unregisterCommand(id: string): void {
		this.registrations.deleteAndDispose(id);
	}

	/** Upstream activates `onCommand:` in the window's extension host; this host activates its own. */
	$fireCommandActivationEvent(): void { }

	async $executeCommand(id: string, args: unknown[] | SerializableObjectWithBuffers<unknown[]>): Promise<unknown> {
		const values = args instanceof SerializableObjectWithBuffers ? args.value : args;
		return this.commands.executeCommand(id, ...values.map((value) => revive(value)));
	}

	async $getCommands(): Promise<string[]> {
		return this.commands.ids();
	}

	dispose(): void {
		this.registrations.dispose();
	}
}
