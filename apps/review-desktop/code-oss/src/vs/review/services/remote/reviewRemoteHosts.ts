/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from "../../../base/common/lifecycle.js";
import { Schemas } from "../../../base/common/network.js";
import { IFileService } from "../../../platform/files/common/files.js";
import { InstantiationType, registerSingleton } from "../../../platform/instantiation/common/extensions.js";
import { createDecorator, IInstantiationService } from "../../../platform/instantiation/common/instantiation.js";
import { ILabelService } from "../../../platform/label/common/label.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { ILifecycleService } from "../../../workbench/services/lifecycle/common/lifecycle.js";
import { IReviewDesktopConnectionService } from "../reviewDesktopConnectionService.js";
import { ReviewRemoteFileSystemRouter } from "./reviewRemoteFileSystemRouter.js";
import { type IReviewRemoteHost, ReviewRemoteHost, ReviewRemoteSession } from "./reviewRemoteHost.js";
import { reviewRemoteAuthority } from "./reviewRemoteAuthority.js";

export const IReviewRemoteHostsService = createDecorator<IReviewRemoteHostsService>("reviewRemoteHostsService");

export interface IReviewRemoteHostsService {
	readonly _serviceBrand: undefined;
	host(serverId: string): Promise<IReviewRemoteHost | undefined>;
}

export function reviewRemoteLabel(serverId: string, alias: string | undefined): string {
	return `${alias ?? serverId.slice(0, 8)}: \${path}`;
}

export class ReviewRemoteHostsService extends Disposable implements IReviewRemoteHostsService {
	declare readonly _serviceBrand: undefined;
	private readonly hosts = new Map<string, ReviewRemoteHost>();
	private readonly router = this._register(new ReviewRemoteFileSystemRouter());
	private readonly labels = this._register(new DisposableMap<string>());
	private closing = false;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService private readonly logService: ILogService,
		@IFileService fileService: IFileService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();
		this._register(fileService.registerProvider(Schemas.vscodeRemote, this.router));
		this._register(lifecycleService.onWillShutdown((event) =>
			event.join(this.closeAll(), { id: "join.reviewRemoteHosts", label: "Disconnecting remote hosts" })));
	}

	async host(serverId: string): Promise<IReviewRemoteHost | undefined> {
		const authority = reviewRemoteAuthority(serverId);
		if (!authority || this.closing) return undefined;
		let host = this.hosts.get(authority);
		if (!host) {
			host = new ReviewRemoteHost(serverId, authority, (target) => this.open(target), this.logService);
			this.hosts.set(authority, host);
		}
		return (await host.connect()) ? host : undefined;
	}

	private async open(host: ReviewRemoteHost): Promise<ReviewRemoteSession | undefined> {
		const endpoint = await this.connection.getRemoteLanguageEndpoint(host.serverId);
		if (!endpoint || this.closing) return undefined;
		void this.label(host);
		const session = this.instantiationService.createInstance(ReviewRemoteSession, host, endpoint, this.router);
		try {
			await session.start();
			return session;
		} catch (error) {
			session.dispose();
			throw error;
		}
	}

	private async label(host: ReviewRemoteHost): Promise<void> {
		const states = await this.connection.readRemoteHosts().catch(() => []);
		const alias = states.find((state) => state.serverId === host.serverId)?.alias;
		if (this.closing) return;
		this.labels.set(host.authority, this.labelService.registerFormatter({
			scheme: Schemas.vscodeRemote,
			authority: host.authority,
			formatting: { label: reviewRemoteLabel(host.serverId, alias), separator: "/" },
		}));
	}

	private async closeAll(): Promise<void> {
		this.closing = true;
		const hosts = [...this.hosts.values()];
		this.hosts.clear();
		await Promise.all(hosts.map((host) => host.close()));
	}

	override dispose(): void {
		this.closing = true;
		for (const host of this.hosts.values()) host.dispose();
		this.hosts.clear();
		super.dispose();
	}
}

registerSingleton(IReviewRemoteHostsService, ReviewRemoteHostsService, InstantiationType.Eager);

class ReviewRemoteHostsStartup {
	static readonly ID = "workbench.contrib.reviewRemoteHosts";
	constructor(@IReviewRemoteHostsService _hosts: IReviewRemoteHostsService) { }
}
registerWorkbenchContribution2(ReviewRemoteHostsStartup.ID, ReviewRemoteHostsStartup, WorkbenchPhase.BlockStartup);
