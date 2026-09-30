/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import type { IStorageService, IStorageValueChangeEvent, StorageScope } from "../../../../platform/storage/common/storage.js";
import { override } from "./reviewRemoteGuard.js";

/**
 * Every key a host reads or writes gets its `whiteboard+<serverId>/` prefix,
 * so its extensions' state is its own: another host's, and the laptop's
 * extensions' state, cannot be named. The host's extension storage service is
 * a separate instance on top of this.
 */
export function reviewRemoteStorageService(base: IStorageService, authority: string): IStorageService {
	const prefix = `${authority}/`;
	const key = (name: string) => prefix + name;
	const mine = (name: string) => name.startsWith(prefix);
	return override(base, {
		get: ((name: string, scope: StorageScope, fallback?: string) => base.get(key(name), scope, fallback)) as IStorageService["get"],
		getBoolean: ((name: string, scope: StorageScope, fallback?: boolean) => base.getBoolean(key(name), scope, fallback)) as IStorageService["getBoolean"],
		getNumber: ((name: string, scope: StorageScope, fallback?: number) => base.getNumber(key(name), scope, fallback)) as IStorageService["getNumber"],
		getObject: ((name: string, scope: StorageScope, fallback?: object) => base.getObject(key(name), scope, fallback)) as IStorageService["getObject"],
		store: (name, value, scope, target) => base.store(key(name), value, scope, target),
		storeAll: (entries, external) => base.storeAll(entries.map((entry) => ({ ...entry, key: key(entry.key) })), external),
		remove: (name, scope) => base.remove(key(name), scope),
		keys: (scope, target) => base.keys(scope, target).filter(mine).map((name) => name.slice(prefix.length)),
		onDidChangeValue: ((scope: StorageScope, name: string | undefined, disposable) =>
			Event.map(
				Event.filter(base.onDidChangeValue(scope, name === undefined ? undefined : key(name), disposable), (e) => mine(e.key)),
				(e): IStorageValueChangeEvent => ({ ...e, key: e.key.slice(prefix.length) }),
			)) as IStorageService["onDidChangeValue"],
	});
}
