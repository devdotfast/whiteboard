import { createDecorator } from "../../platform/instantiation/common/instantiation.js";
import type { URI } from "../../base/common/uri.js";
import { Disposable, toDisposable, type IReference, type IDisposable } from "../../base/common/lifecycle.js";
import type { IReviewRemoteHost } from "./remote/reviewRemoteHost.js";

export const IReviewSnapshotLanguageHosts = createDecorator<IReviewSnapshotLanguageHosts>("reviewSnapshotLanguageHosts");
export interface IReviewSnapshotLanguageHosts {
	readonly _serviceBrand: undefined;
	acquire(root: URI): Promise<IReference<IReviewRemoteHost>>;
}

type SnapshotLanguageHost = IReviewRemoteHost & IDisposable;

/** Shares a checkout's host while readers exist and briefly across editor changes. */
export abstract class ReviewLanguageHostPool extends Disposable {
	private readonly hosts = new Map<
		string,
		{ pending: Promise<SnapshotLanguageHost>; users: number; timer?: ReturnType<typeof setTimeout> }
	>();

	async acquire(root: URI): Promise<IReference<IReviewRemoteHost>> {
		const key = root.toString();
		if (this._store.isDisposed) throw new Error("Language hosts are closed.");
		let entry = this.hosts.get(key);
		if (!entry) {
			entry = { pending: this.open(root), users: 0 };
			this.hosts.set(key, entry);
		}
		clearTimeout(entry.timer);
		entry.users++;
		const current = entry;
		const release = () => {
			if (--current.users !== 0 || this.hosts.get(key) !== current) return;
			current.timer = setTimeout(() => {
				if (current.users || this.hosts.get(key) !== current) return;
				this.hosts.delete(key);
				void current.pending.then(
					(host) => host.dispose(),
					() => {},
				);
			}, 30_000);
		};
		try {
			const host = await entry.pending;
			if (this._store.isDisposed) {
				host.dispose();
				throw new Error("Language hosts are closed.");
			}
			if (host.closed) throw new Error("Snapshot language host stopped.");
			const owner = toDisposable(release);
			return { object: host, dispose: () => owner.dispose() };
		} catch (error) {
			release();
			if (this.hosts.get(key) === current) {
				clearTimeout(current.timer);
				this.hosts.delete(key);
			}
			throw error;
		}
	}

	protected abstract open(root: URI): Promise<SnapshotLanguageHost>;

	override dispose(): void {
		for (const entry of this.hosts.values()) {
			clearTimeout(entry.timer);
			void entry.pending.then(
				(host) => host.dispose(),
				() => {},
			);
		}
		this.hosts.clear();
		super.dispose();
	}
}
