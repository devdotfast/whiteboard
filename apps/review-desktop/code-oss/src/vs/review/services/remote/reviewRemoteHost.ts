/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceTimeout, TimeoutTimer } from "../../../base/common/async.js";
import { toErrorMessage } from "../../../base/common/errorMessage.js";
import { CancellationError } from "../../../base/common/errors.js";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.js";
import { Schemas } from "../../../base/common/network.js";
import * as platform from "../../../base/common/platform.js";
import type { Mutable } from "../../../base/common/types.js";
import { URI } from "../../../base/common/uri.js";
import type { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.js";
import { LanguageFeaturesService } from "../../../editor/common/services/languageFeaturesService.js";
import type { IExtensionDescription } from "../../../platform/extensions/common/extensions.js";
import { DiskFileSystemProviderClient } from "../../../platform/files/common/diskFileSystemProviderClient.js";
import { FileService } from "../../../platform/files/common/fileService.js";
import { IInstantiationService } from "../../../platform/instantiation/common/instantiation.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { IProductService } from "../../../platform/product/common/productService.js";
import {
	connectRemoteAgentManagement,
	type IConnectionOptions,
	PersistentConnectionEventType,
} from "../../../platform/remote/common/remoteAgentConnection.js";
import {
	IRemoteAuthorityResolverService,
	type IRemoteConnectionData,
	RemoteAuthorityResolverError,
	RemoteAuthorityResolverErrorCode,
	WebSocketRemoteConnection,
} from "../../../platform/remote/common/remoteAuthorityResolver.js";
import { RemoteExtensionsScannerChannelName } from "../../../platform/remote/common/remoteExtensionsScanner.js";
import { IRemoteSocketFactoryService } from "../../../platform/remote/common/remoteSocketFactoryService.js";
import { ISignService } from "../../../platform/sign/common/sign.js";
import { ExtensionHostManager } from "../../../workbench/services/extensions/common/extensionHostManager.js";
import { RemoteRunningLocation } from "../../../workbench/services/extensions/common/extensionRunningLocation.js";
import {
	ActivationKind,
	ExtensionHostExtensions,
	type IInternalExtensionService,
} from "../../../workbench/services/extensions/common/extensions.js";
import { RemoteExtensionHost } from "../../../workbench/services/extensions/common/remoteExtensionHost.js";
import { RemoteExtensionEnvironmentChannelClient } from "../../../workbench/services/remote/common/remoteAgentEnvironmentChannel.js";
import { REMOTE_FILE_SYSTEM_CHANNEL_NAME } from "../../../workbench/services/remote/common/remoteFileSystemProviderClient.js";
import { IReviewDesktopConnectionService, type ReviewRemoteLanguageEndpoint } from "../reviewDesktopConnectionService.js";
import { ReviewRemoteRefusals } from "./guard/reviewRemoteGuard.js";
import type { ReviewRemoteFileSystemRouter } from "./reviewRemoteFileSystemRouter.js";
import { ownsRemoteResource, ReviewRemoteWorkspace, reviewRemoteResolver, reviewRemoteScope } from "./reviewRemoteScope.js";

/** A remote machine's extension host, as the window's review code uses it. */
export interface IReviewRemoteHost {
	/** `whiteboard+<serverId>`, lower case. */
	readonly authority: string;
	/** This host's own registry. Its providers never enter the window's. */
	readonly languageFeatures: ILanguageFeaturesService;
	/** What its extensions may not do; each kind is logged once for this host. */
	readonly refusals: ReviewRemoteRefusals;
	addRoot(root: URI): Promise<IDisposable>;
	activateByEvent(event: string): Promise<void>;
}

/** One connection to a host: its Management and extension host connections, which end together. */
export interface IReviewRemoteSession extends IDisposable {
	/** Settles once, when any of its connections has failed for good. */
	readonly failed: Promise<string>;
	activateByEvent(event: string): Promise<void>;
	/** Tells the remote this window left, so its extension host exits now and not after the grace time. */
	close(): Promise<void>;
}

/** 1 s, doubling, at most 60 s. */
export function reviewRemoteRetryDelay(failures: number): number {
	return Math.min(60_000, 1_000 * 2 ** failures);
}

/** A session that lasted this long starts the delays from 1 s again. */
const STABLE_MS = 60_000;

/**
 * Lasts as long as the window. Each session is one connection; when it fails,
 * or the endpoint is not there, the host opens a new one after a delay. Roots,
 * activation events and the registry carry over, so callers keep this object.
 */
export class ReviewRemoteHost extends Disposable implements IReviewRemoteHost {
	readonly languageFeatures: ILanguageFeaturesService = new LanguageFeaturesService();
	readonly workspace: ReviewRemoteWorkspace;
	readonly refusals: ReviewRemoteRefusals;
	/** From `/remote-hosts`, for the refusals a remote's extensions get. */
	alias: string | undefined;
	private session: IReviewRemoteSession | undefined;
	private connecting: Promise<boolean> | undefined;
	private failures = 0;
	private waiting = false;
	private readonly retry = this._register(new TimeoutTimer());
	private readonly activations = new Set<string>();

	constructor(
		readonly serverId: string,
		readonly authority: string,
		/** Resolves undefined when the host has no endpoint now. */
		private readonly open: (host: ReviewRemoteHost) => Promise<IReviewRemoteSession | undefined>,
		private readonly logService: ILogService,
	) {
		super();
		this.workspace = this._register(new ReviewRemoteWorkspace(`whiteboard-remote-${serverId}`));
		this.refusals = new ReviewRemoteRefusals(authority, () => this.alias ?? serverId.slice(0, 8), logService);
	}

	/** True once connected; false when it cannot connect now. Between attempts it waits for the delay. */
	connect(): Promise<boolean> {
		if (this.session) return Promise.resolve(true);
		if (this._store.isDisposed || this.waiting) return Promise.resolve(false);
		this.connecting ??= this.attempt().finally(() => (this.connecting = undefined));
		return this.connecting;
	}

	private async attempt(): Promise<boolean> {
		let session: IReviewRemoteSession | undefined;
		try {
			session = await this.open(this);
		} catch (error) {
			this.logService.warn(`[Remote language] ${this.authority}: could not connect: ${toErrorMessage(error)}`);
		}
		if (this._store.isDisposed) {
			session?.dispose();
			return false;
		}
		if (!session) {
			this.retryLater();
			return false;
		}
		const opened = Date.now();
		this.session = session;
		void session.failed.then((reason) => {
			if (this.session !== session) return;
			this.logService.warn(`[Remote language] ${this.authority}: ${reason} failed; connecting again`);
			this.session = undefined;
			session.dispose();
			if (Date.now() - opened >= STABLE_MS) this.failures = 0;
			this.retryLater();
		});
		for (const event of this.activations) {
			session.activateByEvent(event).catch((error) => this.logService.warn(`[Remote language] ${this.authority}: ${event} failed: ${toErrorMessage(error)}`));
		}
		return true;
	}

	private retryLater(): void {
		this.waiting = true;
		this.retry.cancelAndSet(() => {
			this.waiting = false;
			void this.connect();
		}, reviewRemoteRetryDelay(this.failures++));
	}

	async addRoot(root: URI): Promise<IDisposable> {
		if (!ownsRemoteResource(this.authority, root)) throw new Error("That root is not on this remote host.");
		return this.workspace.add(root);
	}

	/** Also sent to every later session, as the window's extension service does after a restart. */
	async activateByEvent(event: string): Promise<void> {
		this.activations.add(event);
		await this.session?.activateByEvent(event);
	}

	/** For window shutdown and reload. */
	async close(): Promise<void> {
		// A first connect in flight would otherwise leave its extension host on the remote for the grace time.
		if (this.connecting) await raceTimeout(this.connecting, 2_000);
		const session = this.session;
		this.session = undefined;
		this.dispose();
		if (!session) return;
		try {
			await session.close();
		} finally {
			session.dispose();
		}
	}

	override dispose(): void {
		this.session?.dispose();
		this.session = undefined;
		super.dispose();
	}
}

/** Upstream's remote extension host, which also tells whether it started. */
class ReviewRemoteExtensionHost extends RemoteExtensionHost {
	private readonly startResult = new DeferredPromise<void>();
	readonly started = this.startResult.p;

	override start() {
		const started = super.start();
		started.then(() => this.startResult.complete(), (error) => this.startResult.error(error));
		return started;
	}
}

/**
 * Both connections to one host's VS Code server and a stock extension host in
 * the host's own service scope. Every connection isolates its permanent
 * failure, so one failed remote leaves the others alone; this session then
 * ends as a whole.
 */
export class ReviewRemoteSession extends Disposable implements IReviewRemoteSession {
	private readonly failure = new DeferredPromise<string>();
	readonly failed = this.failure.p;
	private manager: ExtensionHostManager | undefined;
	private started = false;

	constructor(
		private readonly host: ReviewRemoteHost,
		/** Used for the first connections only; the token is never kept past this session. */
		private endpoint: ReviewRemoteLanguageEndpoint | undefined,
		private readonly router: ReviewRemoteFileSystemRouter,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IProductService private readonly productService: IProductService,
		@IRemoteSocketFactoryService private readonly remoteSocketFactoryService: IRemoteSocketFactoryService,
		@ISignService private readonly signService: ISignService,
		@ILogService private readonly logService: ILogService,
		@IRemoteAuthorityResolverService private readonly resolverService: IRemoteAuthorityResolverService,
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
	) {
		super();
	}

	/** A reconnect asks main again: it may have moved the forward since. */
	private async address(): Promise<IRemoteConnectionData> {
		const endpoint = this.started ? await this.connection.getRemoteLanguageEndpoint(this.host.serverId) : this.endpoint;
		if (!endpoint) throw new RemoteAuthorityResolverError("The remote host is not available.", RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable);
		return { connectTo: new WebSocketRemoteConnection(endpoint.host, endpoint.port), connectionToken: endpoint.connectionToken };
	}

	private options(): IConnectionOptions {
		return {
			commit: this.productService.commit,
			quality: this.productService.quality,
			addressProvider: { getAddress: () => this.address() },
			remoteSocketFactoryService: this.remoteSocketFactoryService,
			signService: this.signService,
			logService: this.logService,
			ipcLogger: null,
			isolatePermanentFailure: true,
		};
	}

	private fail(reason: string): void {
		if (!this.failure.isSettled) this.failure.complete(reason);
	}

	private check(): void {
		if (this._store.isDisposed) throw new CancellationError();
		if (this.failure.isSettled) throw new Error("A connection failed while it started.");
	}

	async start(): Promise<void> {
		const { authority } = this.host;
		const management = await connectRemoteAgentManagement(this.options(), authority, "renderer");
		if (this._store.isDisposed) {
			management.dispose();
			throw new CancellationError();
		}
		// Its disposal also tells the server this client left.
		this._register(management);
		this._register(management.onDidStateChange((event) => {
			if (event.type === PersistentConnectionEventType.ReconnectionPermanentFailure) this.fail("the Management connection");
		}));
		const environment = await RemoteExtensionEnvironmentChannelClient.getEnvironmentData(
			management.client.getChannel("remoteextensionsenvironment"),
			authority,
			undefined,
		);
		if (environment.reconnectionGraceTime !== undefined) management.updateGraceTime(environment.reconnectionGraceTime);
		const extensions = await management.client
			.getChannel(RemoteExtensionsScannerChannelName)
			.call<Mutable<IExtensionDescription>[]>("scanExtensions", [platform.language, undefined, [], undefined, undefined]);
		for (const extension of extensions) extension.extensionLocation = URI.revive(extension.extensionLocation);
		this.check();

		const files = this._register(new DiskFileSystemProviderClient(management.client.getChannel(REMOTE_FILE_SYSTEM_CHANNEL_NAME), { pathCaseSensitive: true }));
		this._register(this.router.add(authority, files));
		// This host's own disk, writable for its extensions only: the window's router, and so every editor, stays read-only.
		const ownFiles = this._register(new FileService(this.logService));
		this._register(ownFiles.registerProvider(Schemas.vscodeRemote, files));

		const scope = this._register(this.instantiationService.createChild(this.instantiationService.invokeFunction((window) => reviewRemoteScope({
			authority,
			refusals: this.host.refusals,
			extensions,
			activate: (event) => this.activateByEvent(event),
			languageFeatures: this.host.languageFeatures,
			workspace: this.host.workspace,
			resolver: reviewRemoteResolver(this.resolverService, authority, () => this.address()),
			ownFiles,
		}, window))));
		const extensionHost = scope.createInstance(ReviewRemoteExtensionHost, new RemoteRunningLocation(), {
			remoteAuthority: authority,
			isolatePermanentFailure: true,
			getInitData: async () => ({
				connectionData: await this.address(),
				pid: environment.pid,
				appRoot: environment.appRoot,
				extensionHostLogsPath: environment.extensionHostLogsPath,
				globalStorageHome: environment.globalStorageHome,
				workspaceStorageHome: environment.workspaceStorageHome,
				extensions: new ExtensionHostExtensions(1, extensions, extensions.filter((extension) => extension.main).map((extension) => extension.identifier)),
			}),
		});
		const manager = (this.manager = this._register(scope.createInstance(ExtensionHostManager, extensionHost, [], this.internalExtensionService())));
		this._register(manager.onDidExit(() => this.fail("the extension host connection")));
		await extensionHost.started;
		await manager.ready();
		this.check();
		this.started = true;
		this.endpoint = undefined;
	}

	private internalExtensionService(): IInternalExtensionService {
		const log = (message: string) => this.logService.info(`[Remote language] ${this.host.authority}: ${message}`);
		return {
			_activateById: async (id, reason) => {
				await this.manager?.activate(id, reason);
			},
			_onWillActivateExtension: () => { },
			_onDidActivateExtension: (id) => log(`activated ${id.value}`),
			_onDidActivateExtensionError: (id, error) => log(`${id.value} failed to activate: ${toErrorMessage(error)}`),
			_onExtensionRuntimeError: (id, error) => log(`${id.value}: ${toErrorMessage(error)}`),
		};
	}

	async activateByEvent(event: string): Promise<void> {
		await this.manager?.activateByEvent(event, ActivationKind.Normal);
	}

	async close(): Promise<void> {
		await raceTimeout(this.manager?.disconnect() ?? Promise.resolve(), 2_000);
		this.dispose();
	}
}
