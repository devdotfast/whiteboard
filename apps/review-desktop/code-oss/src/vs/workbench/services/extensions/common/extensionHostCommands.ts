import { toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** Each extension workspace resolves its own contributed commands. */
export const IExtensionHostCommands = createDecorator<IExtensionHostCommands>('extensionHostCommands');
export interface IExtensionHostCommands {
	readonly _serviceBrand: undefined;
	readonly commands: Map<string, (...args: unknown[]) => Promise<unknown>>;
	register(id: string, handler: (...args: unknown[]) => Promise<unknown>): IDisposable;
}
export class ExtensionHostCommands implements IExtensionHostCommands {
	declare readonly _serviceBrand: undefined;
	readonly commands = new Map<string, (...args: unknown[]) => Promise<unknown>>();
	register(id: string, handler: (...args: unknown[]) => Promise<unknown>): IDisposable {
		this.commands.set(id, handler);
		// Shared UI, such as an extension's status item, still invokes its command.
		const registration = CommandsRegistry.registerCommand(id, (_accessor, ...args) => handler(...args));
		return toDisposable(() => {
			registration.dispose();
			if (this.commands.get(id) === handler) this.commands.delete(id);
		});
	}
}

class WindowExtensionHostCommands extends ExtensionHostCommands {
	override register(id: string, handler: (...args: unknown[]) => Promise<unknown>): IDisposable {
		return CommandsRegistry.registerCommand(id, (_accessor, ...args) => handler(...args));
	}
}
registerSingleton(IExtensionHostCommands, WindowExtensionHostCommands, InstantiationType.Delayed);
