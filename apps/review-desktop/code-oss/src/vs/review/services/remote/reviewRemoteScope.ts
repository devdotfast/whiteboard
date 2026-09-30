/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from "../../../base/common/event.js";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.js";
import { Schemas } from "../../../base/common/network.js";
import { URI } from "../../../base/common/uri.js";
import type { ITextModel } from "../../../editor/common/model.js";
import { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.js";
import { IModelService } from "../../../editor/common/services/model.js";
import { SyncDescriptor } from "../../../platform/instantiation/common/descriptors.js";
import { ServiceCollection } from "../../../platform/instantiation/common/serviceCollection.js";
import { IMarkerService } from "../../../platform/markers/common/markers.js";
import { IRemoteAuthorityResolverService, type IRemoteConnectionData, type ResolverResult } from "../../../platform/remote/common/remoteAuthorityResolver.js";
import {
	IWorkspaceContextService,
	type IWorkspace,
	type IWorkspaceFolder,
	type IWorkspaceFoldersChangeEvent,
	WorkbenchState,
	Workspace,
	WorkspaceFolder,
} from "../../../platform/workspace/common/workspace.js";
import { ISearchService } from "../../../workbench/services/search/common/search.js";
import { SearchService } from "../../../workbench/services/search/common/searchService.js";

/**
 * `whiteboard+<serverId>`, lower case since URIs come back from a remote with
 * a lower-case authority. The alias is only a label, so renaming it moves no URI.
 */
export function reviewRemoteAuthority(serverId: string): string | undefined {
	return /^[0-9a-z-]+$/i.test(serverId) ? `whiteboard+${serverId.toLowerCase()}` : undefined;
}

export function ownsRemoteResource(authority: string, resource: URI): boolean {
	return resource.scheme === Schemas.vscodeRemote && resource.authority.toLowerCase() === authority;
}

/** The window's service with some members replaced; the rest are the window's own. */
function override<T extends object>(base: T, members: Partial<T>): T {
	return new Proxy(base, {
		get(target, key) {
			if (key in members) return (members as Record<PropertyKey, unknown>)[key];
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** Only this host's remote models reach its extension host. */
export function reviewRemoteModelService(base: IModelService, authority: string): IModelService {
	const mine = (model: ITextModel) => ownsRemoteResource(authority, model.uri);
	return override(base, {
		getModels: () => base.getModels().filter(mine),
		getModel: (resource: URI) => (ownsRemoteResource(authority, resource) ? base.getModel(resource) : null),
		onModelAdded: Event.filter(base.onModelAdded, mine),
		onModelRemoved: Event.filter(base.onModelRemoved, mine),
		onModelLanguageChanged: Event.filter(base.onModelLanguageChanged, (event) => mine(event.model)),
	});
}

/**
 * Owners are namespaced by host, so one host clearing `typescript` leaves the
 * others' markers, and a host reads and writes markers of its own files only.
 */
export function reviewRemoteMarkerService(base: IMarkerService, authority: string): IMarkerService {
	const owner = (name: string) => `${authority}/${name}`;
	const mine = (resource: URI) => ownsRemoteResource(authority, resource);
	return override(base, {
		changeOne: (name, resource, markers) => {
			if (mine(resource)) base.changeOne(owner(name), resource, markers);
		},
		changeAll: (name, data) => base.changeAll(owner(name), data.filter((entry) => mine(entry.resource))),
		remove: (name, resources) => base.remove(owner(name), resources.filter(mine)),
		read: (filter) =>
			base.read(filter?.owner ? { ...filter, owner: owner(filter.owner) } : filter).filter((marker) => mine(marker.resource)),
		onMarkerChanged: Event.filter(
			Event.map(base.onMarkerChanged, (resources) => resources.filter(mine)),
			(resources) => resources.length > 0,
		),
	});
}

/** A host's resolver answers for its own authority with the address it is given. */
export function reviewRemoteResolver(
	base: IRemoteAuthorityResolverService,
	authority: string,
	address: () => Promise<IRemoteConnectionData>,
): IRemoteAuthorityResolverService {
	let last: IRemoteConnectionData | null = null;
	return override(base, {
		resolveAuthority: async (name: string): Promise<ResolverResult> => {
			if (name !== authority) return base.resolveAuthority(name);
			last = await address();
			return { authority: { authority, ...last }, options: {} };
		},
		getConnectionData: (name: string) => (name === authority ? last : base.getConnectionData(name)),
	});
}

/** A host's workspace: only the roots of its own reviews, counted per caller. */
export class ReviewRemoteWorkspace extends Disposable implements IWorkspaceContextService {
	declare readonly _serviceBrand: undefined;

	private readonly counts = new Map<string, { uri: URI; count: number }>();
	private readonly workspace: Workspace;
	private readonly foldersChanged = this._register(new Emitter<IWorkspaceFoldersChangeEvent>());
	readonly onDidChangeWorkspaceFolders = this.foldersChanged.event;
	readonly onWillChangeWorkspaceFolders = Event.None;
	readonly onDidChangeWorkbenchState = Event.None;
	readonly onDidChangeWorkspaceName = Event.None;

	constructor(id: string) {
		super();
		this.workspace = new Workspace(id, [], false, null, () => false);
	}

	add(root: URI): IDisposable {
		const key = root.toString();
		const entry = this.counts.get(key);
		if (entry) entry.count++;
		else {
			this.counts.set(key, { uri: root, count: 1 });
			this.update();
		}
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				const current = this.counts.get(key);
				if (current && --current.count === 0) {
					this.counts.delete(key);
					this.update();
				}
			},
		};
	}

	private update(): void {
		const before = this.workspace.folders;
		const after = [...this.counts.values()].map(
			({ uri }, index) => new WorkspaceFolder({ uri, index, name: uri.path.split("/").pop() || uri.path }),
		);
		const keys = (folders: readonly IWorkspaceFolder[]) => new Set(folders.map((folder) => folder.uri.toString()));
		const [had, has] = [keys(before), keys(after)];
		this.workspace.folders = after;
		this.foldersChanged.fire({
			added: after.filter((folder) => !had.has(folder.uri.toString())),
			removed: before.filter((folder) => !has.has(folder.uri.toString())),
			changed: [],
		});
	}

	getCompleteWorkspace(): Promise<IWorkspace> {
		return Promise.resolve(this.workspace);
	}

	getWorkspace(): IWorkspace {
		return this.workspace;
	}

	getWorkbenchState(): WorkbenchState {
		return WorkbenchState.WORKSPACE;
	}

	getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
		return this.workspace.getFolder(resource);
	}

	isCurrentWorkspace(): boolean {
		return false;
	}

	isInsideWorkspace(resource: URI): boolean {
		return !!this.workspace.getFolder(resource);
	}

	hasWorkspaceData(): boolean {
		return true;
	}
}

/**
 * The services a host's extension host and its main-thread peers see in place
 * of the window's. Everything not listed is the window's own.
 */
export function reviewRemoteScope(input: {
	authority: string;
	languageFeatures: ILanguageFeaturesService;
	workspace: ReviewRemoteWorkspace;
	resolver: IRemoteAuthorityResolverService;
	modelService: IModelService;
	markerService: IMarkerService;
}): ServiceCollection {
	return new ServiceCollection(
		[ILanguageFeaturesService, input.languageFeatures],
		[IModelService, reviewRemoteModelService(input.modelService, input.authority)],
		[IWorkspaceContextService, input.workspace],
		[IMarkerService, reviewRemoteMarkerService(input.markerService, input.authority)],
		// Its own instance, so a file search from this host's extensions reaches this host's search provider.
		[ISearchService, new SyncDescriptor(SearchService)],
		[IRemoteAuthorityResolverService, input.resolver],
	);
}
