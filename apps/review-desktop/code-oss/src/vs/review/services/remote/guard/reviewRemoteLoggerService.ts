/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { ResourceMap } from "../../../../base/common/map.js";
import { URI } from "../../../../base/common/uri.js";
import { type ILogger, type ILoggerResource, type ILoggerService, type LogLevel, NullLogger } from "../../../../platform/log/common/log.js";
import type { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * A host's loggers are files on the remote, which its extension host writes
 * itself. The window keeps only their names: it writes nothing to the laptop's
 * disk for them, never registers them with its own loggers, and sends a host
 * none of the laptop's log files.
 */
export class ReviewRemoteLoggerService implements ILoggerService {
	declare readonly _serviceBrand: undefined;
	private readonly loggers = new ResourceMap<ILogger>();
	private readonly registered = new ResourceMap<ILoggerResource>();
	readonly onDidChangeVisibility = Event.None;
	readonly onDidChangeLoggers = Event.None;
	/** Only the window's level; a level for one of the laptop's log files would name it. */
	readonly onDidChangeLogLevel: Event<LogLevel | [URI, LogLevel]>;

	constructor(
		private readonly base: ILoggerService,
		private readonly refusals: ReviewRemoteRefusals,
	) {
		this.onDidChangeLogLevel = Event.filter(base.onDidChangeLogLevel, (change) => !Array.isArray(change));
	}

	private own(resourceOrId: URI | string): URI {
		if (typeof resourceOrId === "string" || !this.refusals.owns(resourceOrId)) throw this.refusals.refuse("logging to files outside this remote");
		return resourceOrId;
	}

	createLogger(resourceOrId: URI | string): ILogger {
		const resource = this.own(resourceOrId);
		let logger = this.loggers.get(resource);
		if (!logger) this.loggers.set(resource, (logger = new NullLogger()));
		return logger;
	}

	getLogger(resourceOrId: URI | string): ILogger | undefined {
		return URI.isUri(resourceOrId) ? this.loggers.get(resourceOrId) : undefined;
	}

	setLogLevel(): void { }

	getLogLevel(): LogLevel {
		return this.base.getLogLevel();
	}

	setVisibility(): void { }

	registerLogger(resource: ILoggerResource): void {
		this.registered.set(this.own(resource.resource), resource);
	}

	deregisterLogger(idOrResource: URI | string): void {
		if (URI.isUri(idOrResource)) this.registered.delete(idOrResource);
	}

	getRegisteredLoggers(): Iterable<ILoggerResource> {
		return [...this.registered.values()];
	}

	getRegisteredLogger(resource: URI): ILoggerResource | undefined {
		return this.registered.get(resource);
	}
}
