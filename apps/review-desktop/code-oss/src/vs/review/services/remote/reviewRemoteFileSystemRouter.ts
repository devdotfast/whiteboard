/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from "../../../base/common/event.js";
import { Disposable, type IDisposable, toDisposable } from "../../../base/common/lifecycle.js";
import { isEqualOrParent, normalizePath } from "../../../base/common/resources.js";
import type { URI } from "../../../base/common/uri.js";
import {
	createFileSystemProviderError,
	FilePermission,
	type FileType,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	type IFileChange,
	type IFileDeleteOptions,
	type IFileOverwriteOptions,
	type IFileSystemProviderWithFileReadWriteCapability,
	type IFileWriteOptions,
	type IStat,
	type IWatchOptions,
} from "../../../platform/files/common/files.js";

/** Review files on a host are read-only; only the storage the host's extension host was given is writable. */
export class ReviewRemoteFileSystemRouter extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities = Event.None;
	private readonly changed = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this.changed.event;
	private readonly watchErrors = this._register(new Emitter<string>());
	readonly onDidWatchError = this.watchErrors.event;
	private readonly hosts = new Map<string, IFileSystemProviderWithFileReadWriteCapability>();
	private readonly writable = new Map<string, readonly URI[]>();
	private readonly connections = new Map<string, { provider: IFileSystemProviderWithFileReadWriteCapability; writable: readonly URI[] }[]>();

	add(authority: string, provider: IFileSystemProviderWithFileReadWriteCapability, writable: readonly URI[]): IDisposable {
		const entries = this.connections.get(authority) ?? [];
		const entry = { provider, writable };
		entries.push(entry);
		this.connections.set(authority, entries);
		this.hosts.set(authority, provider);
		this.writable.set(authority, writable);
		const changes = provider.onDidChangeFile((e) => this.changed.fire(e));
		const errors = provider.onDidWatchError?.((e) => this.watchErrors.fire(e));
		return toDisposable(() => {
			changes.dispose();
			errors?.dispose();
			const index = entries.indexOf(entry);
			if (index < 0) return;
			entries.splice(index, 1);
			const active = entries.at(-1);
			if (active) { this.hosts.set(authority, active.provider); this.writable.set(authority, active.writable); }
			else { this.connections.delete(authority); this.hosts.delete(authority); this.writable.delete(authority); }
		});
	}

	private host(resource: URI): IFileSystemProviderWithFileReadWriteCapability {
		const host = this.hosts.get(resource.authority.toLowerCase());
		if (!host) throw createFileSystemProviderError("No connected remote host for this file.", FileSystemProviderErrorCode.FileNotFound);
		return host;
	}

	private canWrite(resource: URI): boolean {
		const path = normalizePath(resource);
		return (this.writable.get(resource.authority.toLowerCase()) ?? []).some((root) => isEqualOrParent(path, root));
	}

	private writer(...resources: URI[]): IFileSystemProviderWithFileReadWriteCapability {
		if (!resources.every((resource) => this.canWrite(resource))) {
			throw createFileSystemProviderError("Remote review files are read-only.", FileSystemProviderErrorCode.NoPermissions);
		}
		return this.host(resources[0]);
	}

	async stat(resource: URI): Promise<IStat> {
		const stat = await this.host(resource).stat(resource);
		return this.canWrite(resource) ? stat : { ...stat, permissions: (stat.permissions ?? 0) | FilePermission.Readonly };
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		return this.host(resource).readdir(resource);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		return this.host(resource).readFile(resource);
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		return this.hosts.get(resource.authority.toLowerCase())?.watch(resource, opts) ?? Disposable.None;
	}

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		return this.writer(resource).writeFile(resource, content, opts);
	}

	async mkdir(resource: URI): Promise<void> {
		return this.writer(resource).mkdir(resource);
	}

	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		return this.writer(resource).delete(resource, opts);
	}

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		if (from.authority.toLowerCase() !== to.authority.toLowerCase()) {
			throw createFileSystemProviderError("Files cannot move between remote hosts.", FileSystemProviderErrorCode.NoPermissions);
		}
		return this.writer(from, to).rename(from, to, opts);
	}
}
