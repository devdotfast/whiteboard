/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from "../../../base/common/event.js";
import { Disposable, type IDisposable, toDisposable } from "../../../base/common/lifecycle.js";
import type { URI } from "../../../base/common/uri.js";
import {
	createFileSystemProviderError,
	type FileType,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	type IFileChange,
	type IFileSystemProviderWithFileReadWriteCapability,
	type IStat,
	type IWatchOptions,
} from "../../../platform/files/common/files.js";

/**
 * The window's one `vscode-remote` provider. The window has no remote of its
 * own, so the scheme is free; each call goes to the host its authority names.
 * Reviews are read-only, so it refuses every change.
 */
export class ReviewRemoteFileSystemRouter extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.PathCaseSensitive |
		FileSystemProviderCapabilities.Readonly;
	readonly onDidChangeCapabilities = Event.None;
	private readonly changed = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this.changed.event;
	private readonly watchErrors = this._register(new Emitter<string>());
	readonly onDidWatchError = this.watchErrors.event;
	private readonly hosts = new Map<string, IFileSystemProviderWithFileReadWriteCapability>();

	/** Routes `authority` to a host's remote file system until disposed. */
	add(authority: string, provider: IFileSystemProviderWithFileReadWriteCapability): IDisposable {
		this.hosts.set(authority, provider);
		const changes = provider.onDidChangeFile((e) => this.changed.fire(e));
		const errors = provider.onDidWatchError?.((e) => this.watchErrors.fire(e));
		return toDisposable(() => {
			changes.dispose();
			errors?.dispose();
			if (this.hosts.get(authority) === provider) this.hosts.delete(authority);
		});
	}

	private host(resource: URI): IFileSystemProviderWithFileReadWriteCapability {
		const host = this.hosts.get(resource.authority.toLowerCase());
		if (!host) throw createFileSystemProviderError("No connected remote host for this file.", FileSystemProviderErrorCode.FileNotFound);
		return host;
	}

	async stat(resource: URI): Promise<IStat> {
		return this.host(resource).stat(resource);
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

	writeFile(): Promise<void> {
		return refuse();
	}

	mkdir(): Promise<void> {
		return refuse();
	}

	delete(): Promise<void> {
		return refuse();
	}

	rename(): Promise<void> {
		return refuse();
	}
}

function refuse(): Promise<never> {
	return Promise.reject(createFileSystemProviderError("Remote review files are read-only.", FileSystemProviderErrorCode.NoPermissions));
}
