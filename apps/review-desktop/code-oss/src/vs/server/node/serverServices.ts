/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCancellationError, isSigPipeError, onUnexpectedError } from '../../base/common/errors.js';
import { Emitter, Event } from '../../base/common/event.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { Schemas } from '../../base/common/network.js';
import * as path from '../../base/common/path.js';
import { IURITransformer } from '../../base/common/uriIpc.js';
import { Promises } from '../../base/node/pfs.js';
import { ClientConnectionEvent, IMessagePassingProtocol, IPCServer, IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { ConfigurationService } from '../../platform/configuration/common/configurationService.js';
import { ExtensionHostDebugBroadcastChannel } from '../../platform/debug/common/extensionHostDebugIpc.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../platform/environment/common/environment.js';
import { IFileService } from '../../platform/files/common/files.js';
import { FileService } from '../../platform/files/common/fileService.js';
import { DiskFileSystemProvider } from '../../platform/files/node/diskFileSystemProvider.js';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { InstantiationService } from '../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { AbstractLogger, DEFAULT_LOG_LEVEL, getLogLevel, ILoggerService, ILogService, log, LogLevel, LogLevelToString } from '../../platform/log/common/log.js';
import product from '../../platform/product/common/product.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { RemoteAgentConnectionContext } from '../../platform/remote/common/remoteAgentEnvironment.js';
import { ITelemetryService } from '../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../platform/telemetry/common/telemetryUtils.js';
import { IUriIdentityService } from '../../platform/uriIdentity/common/uriIdentity.js';
import { UriIdentityService } from '../../platform/uriIdentity/common/uriIdentityService.js';
import { RemoteAgentEnvironmentChannel } from './remoteAgentEnvironmentImpl.js';
import { RemoteAgentFileSystemProviderChannel } from './remoteFileSystemProviderServer.js';
import { createURITransformer } from '../../base/common/uriTransformer.js';
import { ServerConnectionToken } from './serverConnectionToken.js';
import { ServerEnvironmentService, ServerParsedArgs } from './serverEnvironmentService.js';
import { REMOTE_FILE_SYSTEM_CHANNEL_NAME } from '../../workbench/services/remote/common/remoteFileSystemProviderClient.js';
import { ExtensionHostStatusService, IExtensionHostStatusService } from './extensionHostStatusService.js';
import { IExtensionsScannerService } from '../../platform/extensionManagement/common/extensionsScannerService.js';
import { ExtensionsScannerService } from './extensionsScannerService.js';
import { IExtensionsProfileScannerService } from '../../platform/extensionManagement/common/extensionsProfileScannerService.js';
import { IUserDataProfilesService } from '../../platform/userDataProfile/common/userDataProfile.js';
import { NullPolicyService } from '../../platform/policy/common/policy.js';
import { LoggerService } from '../../platform/log/node/loggerService.js';
import { ServerUserDataProfilesService } from '../../platform/userDataProfile/node/userDataProfile.js';
import { ExtensionsProfileScannerService } from '../../platform/extensionManagement/node/extensionsProfileScannerService.js';
import { LogService } from '../../platform/log/common/logService.js';
import { LoggerChannel } from '../../platform/log/common/logIpc.js';
import { localize } from '../../nls.js';
import { RemoteExtensionsScannerChannel, RemoteExtensionsScannerService } from './remoteExtensionsScanner.js';
import { RemoteExtensionsScannerChannelName } from '../../platform/remote/common/remoteExtensionsScanner.js';
import { RemoteUserDataProfilesServiceChannel } from '../../platform/userDataProfile/common/userDataProfileIpc.js';
import { IServerLifetimeService, ServerLifetimeService } from './serverLifetimeService.js';
import { CSSDevelopmentService, ICSSDevelopmentService } from '../../platform/cssDev/node/cssDevService.js';

export async function setupServerServices(connectionToken: ServerConnectionToken, args: ServerParsedArgs, REMOTE_DATA_FOLDER: string, disposables: DisposableStore) {
	const services = new ServiceCollection();
	const socketServer = new SocketServer<RemoteAgentConnectionContext>();

	// Whiteboard: upstream installs these through ErrorTelemetry, which is cut with telemetry.
	installErrorListeners();

	const productService: IProductService = { _serviceBrand: undefined, ...product };
	services.set(IProductService, productService);

	const environmentService = new ServerEnvironmentService(args, productService);
	services.set(IEnvironmentService, environmentService);
	services.set(INativeEnvironmentService, environmentService);

	const loggerService = new LoggerService(getLogLevel(environmentService), environmentService.logsHome);
	services.set(ILoggerService, loggerService);
	socketServer.registerChannel('logger', new LoggerChannel(loggerService, (ctx: RemoteAgentConnectionContext) => getUriTransformer(ctx.remoteAuthority)));

	const logger = loggerService.createLogger('remoteagent', { name: localize('remoteExtensionLog', "Server") });
	const logService = disposables.add(new LogService(logger, [new ServerLogger(getLogLevel(environmentService))]));
	services.set(ILogService, logService);
	setTimeout(() => cleanupOlderLogs(environmentService.logsHome.with({ scheme: Schemas.file }).fsPath).then(null, err => logService.error(err)), 10000);
	disposables.add(logService.onDidChangeLogLevel(logLevel => log(logService, logLevel, `Log level changed to ${LogLevelToString(logService.getLevel())}`)));

	logService.trace(`Remote configuration data at ${REMOTE_DATA_FOLDER}`);
	logService.trace('process arguments:', environmentService.args);
	if (Array.isArray(productService.serverGreeting)) {
		logService.info(`\n\n${productService.serverGreeting.join('\n')}\n\n`);
	}

	// ExtensionHost Debug broadcast service
	socketServer.registerChannel(ExtensionHostDebugBroadcastChannel.ChannelName, new ExtensionHostDebugBroadcastChannel());

	// Files
	const fileService = disposables.add(new FileService(logService));
	services.set(IFileService, fileService);
	fileService.registerProvider(Schemas.file, disposables.add(new DiskFileSystemProvider(logService)));

	// URI Identity
	const uriIdentityService = new UriIdentityService(fileService);
	services.set(IUriIdentityService, uriIdentityService);

	// Configuration
	const configurationService = new ConfigurationService(environmentService.machineSettingsResource, fileService, new NullPolicyService(), logService);
	services.set(IConfigurationService, configurationService);

	// User Data Profiles
	const userDataProfilesService = new ServerUserDataProfilesService(uriIdentityService, environmentService, fileService, logService);
	services.set(IUserDataProfilesService, userDataProfilesService);
	socketServer.registerChannel('userDataProfiles', new RemoteUserDataProfilesServiceChannel(userDataProfilesService, (ctx: RemoteAgentConnectionContext) => getUriTransformer(ctx.remoteAuthority)));

	// Dev Only: CSS service (for ESM)
	services.set(ICSSDevelopmentService, new SyncDescriptor(CSSDevelopmentService, undefined, true));

	// Initialize
	// Whiteboard: the machine ids are cut; only telemetry used them.
	await Promise.all([
		configurationService.initialize(),
		userDataProfilesService.init()
	]);

	const extensionHostStatusService = new ExtensionHostStatusService();
	services.set(IExtensionHostStatusService, extensionHostStatusService);

	// Whiteboard: requests, telemetry, the gallery, extension installs and MCP are cut.
	services.set(ITelemetryService, NullTelemetryService);
	services.set(IExtensionsProfileScannerService, new SyncDescriptor(ExtensionsProfileScannerService));
	services.set(IExtensionsScannerService, new SyncDescriptor(ExtensionsScannerService));

	const instantiationService: IInstantiationService = new InstantiationService(services);

	// Whiteboard: terminals are cut.
	const serverLifetimeService = instantiationService.createInstance(ServerLifetimeService, {
		enableAutoShutdown: !!args['enable-remote-auto-shutdown'],
		shutdownWithoutDelay: !!args['remote-auto-shutdown-without-delay'],
	});
	services.set(IServerLifetimeService, serverLifetimeService);

	// Whiteboard: the agent host and MCP are cut.

	instantiationService.invokeFunction(accessor => {
		const extensionsScannerService = accessor.get(IExtensionsScannerService);
		const remoteExtensionEnvironmentChannel = new RemoteAgentEnvironmentChannel(connectionToken, environmentService, userDataProfilesService, extensionHostStatusService, logService);
		socketServer.registerChannel('remoteextensionsenvironment', remoteExtensionEnvironmentChannel);

		// Whiteboard: the client always opens this channel; telemetry is cut.
		socketServer.registerChannel('telemetry', new NullTelemetryChannel());

		const remoteExtensionsScanner = new RemoteExtensionsScannerService(userDataProfilesService, extensionsScannerService, logService);
		socketServer.registerChannel(RemoteExtensionsScannerChannelName, new RemoteExtensionsScannerChannel(remoteExtensionsScanner, (ctx: RemoteAgentConnectionContext) => getUriTransformer(ctx.remoteAuthority)));

		const remoteFileSystemChannel = disposables.add(new RemoteAgentFileSystemProviderChannel(logService, environmentService, configurationService));
		socketServer.registerChannel(REMOTE_FILE_SYSTEM_CHANNEL_NAME, remoteFileSystemChannel);
	});

	return { socketServer, instantiationService };
}

// Whiteboard: the listeners of upstream's node `ErrorTelemetry.installErrorListeners`.
function installErrorListeners(): void {
	// Print a console message when rejection isn't handled within N seconds. For details:
	// see https://nodejs.org/api/process.html#process_event_unhandledrejection
	// and https://nodejs.org/api/process.html#process_event_rejectionhandled
	const unhandledPromises: Promise<unknown>[] = [];
	process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
		unhandledPromises.push(promise);
		setTimeout(() => {
			const idx = unhandledPromises.indexOf(promise);
			if (idx >= 0) {
				promise.catch(e => {
					unhandledPromises.splice(idx, 1);
					if (!isCancellationError(e)) {
						console.warn(`rejected promise not handled within 1 second: ${e}`);
						if (e.stack) {
							console.warn(`stack trace: ${e.stack}`);
						}
						if (reason) {
							onUnexpectedError(reason);
						}
					}
				});
			}
		}, 1000);
	});

	process.on('rejectionHandled', (promise: Promise<unknown>) => {
		const idx = unhandledPromises.indexOf(promise);
		if (idx >= 0) {
			unhandledPromises.splice(idx, 1);
		}
	});

	// Print a console message when an exception isn't handled.
	process.on('uncaughtException', (err: Error | NodeJS.ErrnoException) => {
		if (isSigPipeError(err)) {
			return;
		}

		onUnexpectedError(err);
	});
}

class NullTelemetryChannel implements IServerChannel<RemoteAgentConnectionContext> {
	async call<T>(): Promise<T> { return undefined as T; }
	listen<T>(): Event<T> { return Event.None; }
}

const _uriTransformerCache: { [remoteAuthority: string]: IURITransformer } = Object.create(null);

function getUriTransformer(remoteAuthority: string): IURITransformer {
	if (!_uriTransformerCache[remoteAuthority]) {
		_uriTransformerCache[remoteAuthority] = createURITransformer(remoteAuthority);
	}
	return _uriTransformerCache[remoteAuthority];
}

export class SocketServer<TContext = string> extends IPCServer<TContext> {

	private _onDidConnectEmitter: Emitter<ClientConnectionEvent>;

	constructor() {
		const emitter = new Emitter<ClientConnectionEvent>();
		super(emitter.event);
		this._onDidConnectEmitter = emitter;
	}

	public acceptConnection(protocol: IMessagePassingProtocol, onDidClientDisconnect: Event<void>): void {
		this._onDidConnectEmitter.fire({ protocol, onDidClientDisconnect });
	}
}

class ServerLogger extends AbstractLogger {
	private useColors: boolean;

	constructor(logLevel: LogLevel = DEFAULT_LOG_LEVEL) {
		super();
		this.setLevel(logLevel);
		this.useColors = Boolean(process.stdout.isTTY);
	}

	trace(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Trace)) {
			if (this.useColors) {
				console.log(`\x1b[90m[${now()}]\x1b[0m`, message, ...args);
			} else {
				console.log(`[${now()}]`, message, ...args);
			}
		}
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Debug)) {
			if (this.useColors) {
				console.log(`\x1b[90m[${now()}]\x1b[0m`, message, ...args);
			} else {
				console.log(`[${now()}]`, message, ...args);
			}
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info)) {
			if (this.useColors) {
				console.log(`\x1b[90m[${now()}]\x1b[0m`, message, ...args);
			} else {
				console.log(`[${now()}]`, message, ...args);
			}
		}
	}

	warn(message: string | Error, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Warning)) {
			if (this.useColors) {
				console.warn(`\x1b[93m[${now()}]\x1b[0m`, message, ...args);
			} else {
				console.warn(`[${now()}]`, message, ...args);
			}
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Error)) {
			if (this.useColors) {
				console.error(`\x1b[91m[${now()}]\x1b[0m`, message, ...args);
			} else {
				console.error(`[${now()}]`, message, ...args);
			}
		}
	}

	flush(): void {
		// noop
	}
}

function now(): string {
	const date = new Date();
	return `${twodigits(date.getHours())}:${twodigits(date.getMinutes())}:${twodigits(date.getSeconds())}`;
}

function twodigits(n: number): string {
	if (n < 10) {
		return `0${n}`;
	}
	return String(n);
}

/**
 * Cleans up older logs, while keeping the 10 most recent ones.
 */
async function cleanupOlderLogs(logsPath: string): Promise<void> {
	const currentLog = path.basename(logsPath);
	const logsRoot = path.dirname(logsPath);

	if (!await Promises.exists(logsRoot)) {
		return; // Logs root doesn't exist yet, nothing to clean up
	}

	const children = await Promises.readdir(logsRoot);
	const allSessions = children.filter(name => /^\d{8}T\d{6}$/.test(name));
	const oldSessions = allSessions.sort().filter((d) => d !== currentLog);
	const toDelete = oldSessions.slice(0, Math.max(0, oldSessions.length - 9));

	await Promise.all(toDelete.map(name => Promises.rm(path.join(logsRoot, name))));
}
