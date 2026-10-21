import { RunOnceScheduler } from "../../base/common/async.js";
import { Emitter } from "../../base/common/event.js";
import { Disposable } from "../../base/common/lifecycle.js";
import { CancellationError } from "../../base/common/errors.js";
import { derivedWithSetter, observableValue, type ISettableObservable } from "../../base/common/observable.js";
import { structuralFilePath, STRUCTURAL_WIRE_VERSION, type StructuralEvent, type StructuralRegion, type StructuralTextDiff } from "../common/reviewStructuralDiff.js";
import type { StructuralDiff } from "../common/reviewProtocol.js";
import type { StructuralDiffStream } from "./reviewStructuralDiffClient.js";

export interface StructuralFileResult {
	diff?: StructuralDiff;
	error?: string;
	hidden?: string;
}

export type StructuralFailureReason = "missing_binary" | "process_exit" | "stream_ended" | "aborted" | "file_error" | "other";

export interface StructuralSessionChange {
	/** Files whose diff or fold state changed. */
	readonly files: ReadonlySet<string>;
	readonly status: boolean;
}

/** One comparison, owned by the review. Views only observe it and change fold state. */
export class StructuralDiffSession extends Disposable {
	private readonly changed = this._register(new Emitter<StructuralSessionChange>());
	readonly onDidChange = this.changed.event;
	private readonly pendingFiles = new Set<string>();
	private pendingStatus = false;
	private readonly notification = this._register(new RunOnceScheduler(() => this.flushChanges(), 16));
	private readonly abort = new AbortController();
	private readonly results = new Map<string, StructuralFileResult>();
	private readonly folds = new Map<string, boolean | ISettableObservable<boolean>>();
	/** Folds the reader set; diffr updates leave them alone. */
	private readonly touched = new Set<string>();
	private manifest: Set<string> | undefined;
	private task: Promise<void> | undefined;
	private finished = false;
	private disposed = false;
	error: string | undefined;
	get complete(): boolean { return this.finished; }

	constructor(private readonly client: StructuralDiffStream) { super(); }

	start(): Promise<void> { return this.task ??= this.consume(); }
	getFileResult(path: string): StructuralFileResult | undefined { return this.results.get(path); }
	/** Wait only for this file; a structural view can render while other files stream. */
	fileResult(path: string): Promise<StructuralFileResult> {
		const current = this.results.get(path);
		if (current) return Promise.resolve(current);
		if (this.disposed) return Promise.reject(new CancellationError());
		if (this.finished) return Promise.resolve(this.missingResult());
		return new Promise((resolve, reject) => {
			const finish = () => {
				const result = this.results.get(path);
				if (!result && !this.finished && !this.disposed) return;
				listener.dispose();
				this.abort.signal.removeEventListener("abort", cancel);
				if (this.disposed) reject(new CancellationError());
				else resolve(result ?? this.missingResult());
			};
			const cancel = () => finish();
			const listener = this.onDidChange(change => {
				if (change.files.has(path) || change.status) finish();
			});
			this.abort.signal.addEventListener("abort", cancel, { once: true });
			finish();
		});
	}
	/** Why this comparison failed, or `undefined` when every file has a diff. */
	failure(): { reason: StructuralFailureReason; files: number } | undefined {
		if (!this.finished || this.disposed) return undefined;
		const files = [...this.manifest ?? []].filter(path => !this.results.get(path)?.diff).length;
		const error = this.error;
		if (!error) return files ? { reason: "file_error", files } : undefined;
		const reason = error.includes("executable is missing") ? "missing_binary"
			: error.startsWith("diffr exited with") ? "process_exit"
				: error.includes("ended before completion") ? "stream_ended"
					: error.startsWith("diffr stopped early") ? "aborted" : "other";
		return { reason, files };
	}
	private missingResult(): StructuralFileResult { return { error: this.error ?? "diffr did not supply a result for this file." }; }
	getTextDiff(path: string): StructuralTextDiff | undefined {
		const diff = this.results.get(path)?.diff;
		return diff?.type === "text" ? diff : undefined;
	}
	isRegionCollapsed(path: string, id: number): boolean | undefined {
		const state = this.folds.get(`${path}:${id}`);
		return typeof state === "boolean" ? state : state?.get();
	}
	/** The file header owns the root fold. There is no separate file collapse state. */
	fileCollapse(path: string): ISettableObservable<boolean> {
		const diff = this.getTextDiff(path);
		const root = (diff?.rhs ?? diff?.lhs)?.root;
		const state = root ? this.folds.get(`${path}:${root.fold_state_id}`) : undefined;
		if (!state || typeof state === "boolean") throw new Error(`Missing root collapse state for ${path}.`);
		return state;
	}
	setRegionCollapsed(path: string, id: number, collapsed: boolean): void {
		const key = `${path}:${id}`;
		if (this.disposed) return;
		this.touched.add(key);
		const state = this.folds.get(key);
		if (typeof state === "object") state.set(collapsed, undefined);
		else if (state !== collapsed) { this.folds.set(key, collapsed); this.notify(path); }
	}

	private createFold(path: string, id: number, initial: boolean): ISettableObservable<boolean> {
		const state = observableValue(this, initial);
		return derivedWithSetter(this, reader => state.read(reader), (collapsed, tx) => {
			if (this.disposed) return;
			this.touched.add(`${path}:${id}`);
			if (state.get() === collapsed) return;
			state.set(collapsed, tx);
			this.notify(path);
		});
	}

	private async consume(): Promise<void> {
		try {
			for await (const event of this.client.streamComparison(this.abort.signal)) {
				if (this.disposed) return;
				this.applyEvent(event);
			}
			if (!this.finished) throw new Error("diffr stream ended before completion.");
		} catch (error) {
			if (!this.disposed) {
				this.error = error instanceof Error ? error.message : String(error);
				this.finished = true;
				this.notify(undefined, true);
			}
		} finally {
			this.notification.cancel();
			if (!this.disposed) this.flushChanges();
		}
	}

	private applyEvent(event: StructuralEvent): void {
		if (this.finished) throw new Error("diffr emitted data after completion.");
		if (!this.manifest) {
			if (event.type !== "start" || event.version !== STRUCTURAL_WIRE_VERSION) throw new Error("Unsupported diffr stream protocol.");
			this.acceptManifest(event);
		} else if (event.type === "file") this.storeFileResult(event);
		else if (event.type === "update") this.applyUpdate(event);
		else if (event.type === "complete") this.finishLoading(event);
		else throw new Error(`Unexpected diffr event: ${(event as StructuralEvent).type}`);
		if (event.type === "file" || event.type === "update") this.notify(structuralFilePath(event.file));
		else this.notify(undefined, true);
	}

	private notify(path?: string, status = false): void {
		if (path) this.pendingFiles.add(path);
		this.pendingStatus ||= status;
		if (!this.notification.isScheduled()) this.notification.schedule();
	}

	private flushChanges(): void {
		if (!this.pendingFiles.size && !this.pendingStatus) return;
		const change: StructuralSessionChange = {
			files: new Set(this.pendingFiles), status: this.pendingStatus,
		};
		this.pendingFiles.clear(); this.pendingStatus = false;
		this.changed.fire(change);
	}

	private acceptManifest(event: Extract<StructuralEvent, { type: "start" }>): void {
		this.manifest = new Set(event.files.map(file => structuralFilePath(file.file)));
		if (this.manifest.size !== event.files.length) throw new Error("diffr repeated a file in its manifest.");
	}

	private storeFileResult(event: Extract<StructuralEvent, { type: "file" }>): void {
		const path = structuralFilePath(event.file);
		if (!this.manifest!.has(path) || this.results.has(path)) throw new Error(`Unexpected or repeated diffr result: ${path}`);
		if (event.error) { this.results.set(path, { error: event.error.message }); return; }
		this.storeDiff(path, event.diff, false);
	}

	/** Updates only change visibility; folds the reader has not touched follow them. */
	private applyUpdate(event: Extract<StructuralEvent, { type: "update" }>): void {
		const path = structuralFilePath(event.file);
		if (!this.results.get(path)?.diff) throw new Error(`Unexpected diffr update: ${path}`);
		if (!event.error) this.storeDiff(path, event.diff, true);
	}

	private storeDiff(path: string, diff: StructuralDiff, refresh: boolean): void {
		if (diff.type === "text") {
			const seed = (region: StructuralRegion) => {
				const key = `${path}:${region.fold_state_id}`;
				const collapsed = region.visibility?.collapsed === true;
				const state = this.folds.get(key);
				if (state === undefined) this.folds.set(key, collapsed);
				else if (refresh && !this.touched.has(key)) {
					if (typeof state === "boolean") this.folds.set(key, collapsed);
					else { state.set(collapsed, undefined); this.touched.delete(key); }
				}
				if (region.kind === "fold") region.children.forEach(seed);
			};
			for (const side of [diff.lhs, diff.rhs]) if (side) {
				seed(side.root);
				const key = `${path}:${side.root.fold_state_id}`;
				const state = this.folds.get(key)!;
				// Only roots need a synchronous observable for multi-diff headers;
				// interior folds keep using the session's batched notifications.
				if (typeof state === "boolean") this.folds.set(key, this.createFold(path, side.root.fold_state_id, state));
			}
		}
		const visibility = diff.type === "text"
			? [diff.rhs, diff.lhs].find(side => side?.root.visibility?.collapsed)?.root.visibility
			: undefined;
		this.results.set(path, { diff, hidden: visibility ? visibility.label || "Hidden by default" : undefined });
	}

	private finishLoading(event: Extract<StructuralEvent, { type: "complete" }>): void {
		for (const path of this.manifest!) if (!this.results.has(path)) { this.results.set(path, this.missingResult()); this.pendingFiles.add(path); }
		this.finished = true;
		if (event.aborted) this.error = `diffr stopped early: ${event.aborted.message}`;
	}

	override dispose(): void {
		this.disposed = true;
		this.abort.abort();
		this.results.clear();
		this.folds.clear();
		this.touched.clear();
		this.pendingFiles.clear();
		super.dispose();
	}
}
