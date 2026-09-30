import { raceTimeout, timeout } from "../../base/common/async.js";
import type { CancellationToken } from "../../base/common/cancellation.js";
import { Disposable, DisposableStore, RefCountedDisposable, toDisposable, type IDisposable, type IReference } from "../../base/common/lifecycle.js";
import { URI } from "../../base/common/uri.js";
import { Position } from "../../editor/common/core/position.js";
import type { Hover, LocationLink } from "../../editor/common/languages.js";
import { EndOfLinePreference, type ITextModel } from "../../editor/common/model.js";
import { ILanguageFeaturesService } from "../../editor/common/services/languageFeatures.js";
import { IModelService } from "../../editor/common/services/model.js";
import { ITextModelService, type IResolvedTextEditorModel } from "../../editor/common/services/resolverService.js";
import { getDefinitionsAtPosition, getImplementationsAtPosition, getTypeDefinitionsAtPosition } from "../../editor/contrib/gotoSymbol/browser/goToSymbol.js";
import { getHoversPromise } from "../../editor/contrib/hover/browser/getHover.js";
import { IFileService } from "../../platform/files/common/files.js";
import { ILogService } from "../../platform/log/common/log.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../workbench/common/contributions.js";
import { IExtensionService } from "../../workbench/services/extensions/common/extensions.js";
import { ITextFileService } from "../../workbench/services/textfile/common/textfiles.js";
import { IWorkspaceEditingService } from "../../workbench/services/workspaces/common/workspaceEditing.js";
import { reviewSourceQuery, type ReviewLanguageEnvironment, type ReviewRemoteLanguageEnvironment } from "../common/reviewProtocol.js";
import { sourceLocation } from "../common/reviewSourceView.js";
import { reviewWorkspaceLanguageEvent } from "../common/reviewWorkspaceLanguageActivation.js";
import { REVIEW_LANGUAGE_SOURCE_SCHEME } from "../common/reviewReadonlySource.js";
import { REVIEW_API_SOURCE_SCHEME } from "./reviewApiSourceService.js";
import { IReviewDesktopConnectionService } from "./reviewDesktopConnectionService.js";
import { withCurrentLocalContext } from "./reviewLocalRequest.js";
import { acquireReviewLanguageRoot, reviewLanguageRoot } from "./reviewLocalWorkspace.js";
import { ReviewLanguageEnvironmentRequests } from "./reviewLanguageEnvironmentRequests.js";
import { watchAttachedReviewModels, withRetainedSource } from "./reviewSourceModelLifecycle.js";
import { ownsRemoteResource, ReviewRemoteRefusals } from "./remote/guard/reviewRemoteGuard.js";
import type { IReviewRemoteHost } from "./remote/reviewRemoteHost.js";
import { IReviewRemoteHostsService } from "./remote/reviewRemoteHosts.js";

/** A remote review's host may be offline or reconnecting; its answer is given up after this, and the next request asks again. */
const REMOTE_ANSWER_MS = 5_000;

interface LocalSource {
	identity: string;
	root: URI;
	/** The remote machine that holds the checkout; undefined on the laptop. */
	remote?: { host: IReviewRemoteHost; refusals: ReviewRemoteRefusals };
	reference: IReference<IResolvedTextEditorModel>;
	retain(): IDisposable | undefined;
	dispose(): void;
}

/** Review bytes remain pinned; language queries use the resolved project environment. */
export class ReviewLocalLanguageFeatures extends Disposable {
	static readonly ID = "review.localLanguageFeatures";
	/** `root` names the host too, so the same review and path on another machine is a different source. */
	private readonly sources = new Map<ITextModel, { identity: string; root: string; pending: Promise<LocalSource | undefined> }>();
	/** Reviews whose language context last came from a remote host. */
	private readonly remoteReviews = new Set<string>();
	private readonly environments = new ReviewLanguageEnvironmentRequests();
	private readonly roots = new Map<string, number>();
	private readonly uncertainRoots = new Set<string>();
	private generation = 0;

	constructor(
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
		@ITextModelService private readonly models: ITextModelService,
		@IModelService modelService: IModelService,
		@ILanguageFeaturesService private readonly languages: ILanguageFeaturesService,
		@IExtensionService private readonly extensions: IExtensionService,
		@IWorkspaceEditingService private readonly workspace: IWorkspaceEditingService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@IFileService private readonly files: IFileService,
		@ILogService private readonly log: ILogService,
		@IReviewRemoteHostsService private readonly remoteHosts: IReviewRemoteHostsService,
	) {
		super();
		this._register(connection.onDidChangeConnection(() => {
			this.environments.invalidate();
			this.generation++;
			for (const entry of this.sources.values()) {
				this.uncertainRoots.add(entry.root);
				void entry.pending.then(source => source?.dispose());
			}
			this.sources.clear();
		}));
		this._register(files.onDidFilesChange(event => {
			if ([...this.roots.keys()].some(root => event.affects(URI.parse(root)))) this.generation++;
		}));
		// Diff models include off-screen files; only attached editors warm native models.
		this._register(watchAttachedReviewModels(modelService, [REVIEW_API_SOURCE_SCHEME, REVIEW_LANGUAGE_SOURCE_SCHEME],
			model => { void this.localSource(model, true); },
			model => this.releaseSource(model)));
		for (const scheme of [REVIEW_API_SOURCE_SCHEME, REVIEW_LANGUAGE_SOURCE_SCHEME]) {
			const selector = { scheme, exclusive: true };
			this._register(languages.hoverProvider.register(selector, { provideHover: (model, position, token) => this.hover(model, position, token) }));
			this._register(languages.definitionProvider.register(selector, { provideDefinition: (model, position, token) => this.locations(model, position, token, "definition") }));
		}
		// Unified hover/definition already delegate to the pinned side model.
		for (const scheme of [REVIEW_API_SOURCE_SCHEME, REVIEW_LANGUAGE_SOURCE_SCHEME]) {
			const target = { scheme, exclusive: true };
			this._register(languages.typeDefinitionProvider.register(target, { provideTypeDefinition: (model, position, token) => this.locations(model, position, token, "type") }));
			this._register(languages.implementationProvider.register(target, { provideImplementation: (model, position, token) => this.locations(model, position, token, "implementation") }));
			this._register(languages.referenceProvider.register(target, {
				provideReferences: (model, position, context, token) => this.withSource(model, position, token, async (local, at, pinned, source) => {
					const results = await Promise.all(this.registry(source).referenceProvider.ordered(local).map(provider => provider.provideReferences(local, at, context, token)));
					return this.reviewLocations(pinned, results.flatMap(result => result ?? []), token, source);
				}),
			}));
		}
	}

	private async environment(model: ITextModel, validate = false): Promise<ReviewLanguageEnvironment | ReviewRemoteLanguageEnvironment | undefined> {
		const { serverUrl, token } = await this.connection.getConnection();
		const target = sourceLocation(model.uri);
		return this.environments.read(JSON.stringify([serverUrl, token]), target.view, target.side, async () => {
			const params = new URLSearchParams({ side: target.side });
			for (const [key, value] of Object.entries(reviewSourceQuery(target.view))) {
				if (value !== undefined) params.set(key, String(value));
			}
			const response = await fetch(`${serverUrl}/reviews-api/${encodeURIComponent(model.uri.authority)}/language-context?${params}`, {
				headers: { "x-review-token": token }, signal: AbortSignal.timeout(10_000),
			});
			return response.ok ? response.json() : undefined;
		}, validate);
	}

	private releaseSource(model: ITextModel): void {
		const entry = this.sources.get(model);
		if (!entry) return;
		this.sources.delete(model);
		void entry.pending.then(source => source?.dispose());
	}

	private async localSource(model: ITextModel, warming = false): Promise<LocalSource | undefined> {
		if (this._store.isDisposed || model.isDisposed() || new URLSearchParams(model.uri.query).has("empty")) return undefined;
		try {
			const epoch = this.environments.generation;
			const context = await this.environment(model);
			if (epoch !== this.environments.generation || this._store.isDisposed || model.isDisposed() || (warming && !model.isAttachedToEditor())) return undefined;
			if (context && "remoteRootPath" in context) this.remoteReviews.add(model.uri.authority);
			else if (context) this.remoteReviews.delete(model.uri.authority);
			const target = reviewLanguageRoot(context);
			const cached = this.sources.get(model);
			if (cached && cached.identity === context?.identity && cached.root === target?.root.toString()) return cached.pending;
			if (cached) {
				this.uncertainRoots.add(cached.root);
				void cached.pending.then(source => source?.dispose());
				this.sources.delete(model);
				this.generation++;
			}
			if (!context || !target) return undefined;
			const pending = this.acquire(model, target, context.identity).catch(error => {
				this.log.debug("[Whiteboard] Language model unavailable", error);
				return undefined;
			});
			const entry = { identity: context.identity, root: target.root.toString(), pending };
			this.sources.set(model, entry);
			const result = await pending;
			if (this.sources.get(model) !== entry || epoch !== this.environments.generation) { result?.dispose(); return undefined; }
			if (!result) this.sources.delete(model);
			return result;
		} catch (error) {
			const cached = this.sources.get(model);
			if (cached) this.uncertainRoots.add(cached.root);
			this.log.debug("[Whiteboard] Language environment unavailable", error);
			return undefined;
		}
	}

	private async acquire(model: ITextModel, { root, serverId }: { root: URI; serverId?: string }, identity: string): Promise<LocalSource | undefined> {
		const relative = model.uri.path.slice(1);
		if (!relative || relative.split(/[\\/]/).some(part => part === "..")) return undefined;
		// Laptop files are the laptop's; a remote review's language source is its host's own files.
		if (serverId !== undefined && model.uri.scheme === REVIEW_LANGUAGE_SOURCE_SCHEME) return undefined;
		const resource = model.uri.scheme === REVIEW_LANGUAGE_SOURCE_SCHEME ? URI.file(model.uri.path) : URI.joinPath(root, relative);
		// Undefined while the host cannot connect; it keeps trying, and the next request asks again.
		const host = serverId === undefined ? undefined : await raceTimeout(this.remoteHosts.host(serverId), REMOTE_ANSWER_MS);
		if (serverId !== undefined && !host) return undefined;
		if (!await this.files.exists(resource) || model.isDisposed()) return undefined;
		const owned = new DisposableStore();
		try {
			owned.add(host ? await host.addRoot(root) : await acquireReviewLanguageRoot(this.workspace, root));
			this.roots.set(root.toString(), (this.roots.get(root.toString()) ?? 0) + 1);
			owned.add({
				dispose: () => {
					const count = (this.roots.get(root.toString()) ?? 1) - 1;
					if (count > 0) this.roots.set(root.toString(), count);
					else this.roots.delete(root.toString());
				}
			});
			const reference = owned.add(await this.models.createModelReference(resource));
			owned.add(reference.object.textEditorModel.onDidChangeContent(() => this.generation++));
		if (model.isDisposed()) { owned.dispose(); return undefined; }
			const languageId = reference.object.textEditorModel.getLanguageId();
			const events = [`onLanguage:${languageId}`, reviewWorkspaceLanguageEvent(languageId)];
			// A reconnecting host replays the activation itself; its providers arrive when it is back.
			if (host) await raceTimeout((async () => { for (const event of events) await host.activateByEvent(event); })(), REMOTE_ANSWER_MS);
			// Folder changes reach the extension host before this activation request.
			else for (const event of events) await this.extensions.activateByEvent(event);
			if (model.isDisposed()) { owned.dispose(); return undefined; }
			const lifetime = new RefCountedDisposable(owned);
			const owner = toDisposable(() => lifetime.release());
			return {
				root, reference, identity,
				remote: host && { host, refusals: new ReviewRemoteRefusals(host.authority, () => host.authority, this.log) },
				retain: () => {
					if (owned.isDisposed) return undefined;
					lifetime.acquire();
					return toDisposable(() => lifetime.release());
				},
				dispose: () => owner.dispose(),
			};
		} catch (error) { owned.dispose(); throw error; }
	}

	private async withSource<T>(model: ITextModel, position: Position, token: CancellationToken, run: (local: ITextModel, at: Position, review: ITextModel, source: LocalSource | undefined) => Promise<T>): Promise<T | undefined> {
		const answer = this.query(model, position, token, run);
		// Checked when the time is up: a first request learns only from its answer whether the review is remote.
		const limit = timeout(REMOTE_ANSWER_MS);
		try {
			return await Promise.race([answer, limit.then(() => this.remoteReviews.has(model.uri.authority) ? undefined : answer)]);
		} finally {
			limit.cancel();
		}
	}

	private async query<T>(model: ITextModel, position: Position, token: CancellationToken, run: (local: ITextModel, at: Position, review: ITextModel, source: LocalSource | undefined) => Promise<T>): Promise<T | undefined> {
		if (token.isCancellationRequested || model.isDisposed()) return undefined;
		if (model.uri.scheme === "file") return withCurrentLocalContext([model], token, () => this.generation, async () => run(model, position, model, undefined));
		const epoch = this.environments.generation;
		const source = await this.localSource(model);
		if (!source) return undefined;
		// Detaching the editor can release its warm owner while a request awaits
		// disk or an extension provider. Keep that request's model/root alive.
		try {
			return await withRetainedSource(source, async () => {
				if (token.isCancellationRequested || model.isDisposed()) return undefined;
				const local = source.reference.object.textEditorModel;
				if (!await this.files.exists(local.uri)) { this.uncertainRoots.add(source.root.toString()); return undefined; }
				if (this.uncertainRoots.has(source.root.toString())) {
					// An open dependency can outlive a removed checkout and miss subsequent
					// watcher updates. Until watcher readiness is authoritative, revalidate
					// clean native buffers before querying; never replace a dirty buffer.
					const prefix = source.root.path.replace(/\/$/, "") + "/";
					await Promise.all(this.textFiles.files.models.filter(file => !file.isDirty() && file.resource.scheme === source.root.scheme && file.resource.authority === source.root.authority && file.resource.path.startsWith(prefix))
						.map(file => this.textFiles.files.resolve(file.resource, { reload: { async: false } })));
				}
				// Resolve current disk contents, preserving any unsaved local editor buffer.
				await this.textFiles.files.resolve(local.uri, { reload: { async: false } });
				return await withCurrentLocalContext([model, local], token, () => this.generation, async () => {
					// The language server must see exactly the source displayed in the review.
					if (!sameSource(model, local)) return undefined;
					const result = await run(local, position, model, source);
					const current = await this.environment(model, true).catch(() => undefined);
					if (epoch === this.environments.generation && reviewLanguageRoot(current)?.root.toString() === source.root.toString() && current?.identity === source.identity) return result;
					// Failed validation must also release the old workspace/watchers. Keeping
					// them after deletion can leave the language server blind to later edits.
					const cached = this.sources.get(model);
					if (cached?.identity === source.identity && cached.root === source.root.toString()) {
						this.uncertainRoots.add(source.root.toString());
						this.sources.delete(model);
						void cached.pending.then(value => value?.dispose());
						this.generation++;
					}
					return undefined;
				});
			});
		} finally {
			if (!model.isAttachedToEditor()) this.releaseSource(model);
		}
	}

	/** A remote review's documents are answered only by its host's registry; the window's has the laptop's degraded copy. */
	private registry(source: LocalSource | undefined): ILanguageFeaturesService {
		return source?.remote?.host.languageFeatures ?? this.languages;
	}

	private hover(model: ITextModel, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		return this.withSource(model, position, token, async (local, at, _review, source) => {
			const hovers = await getHoversPromise(this.registry(source).hoverProvider, local, at, token);
			if (!hovers.length) return undefined;
			const range = hovers[0].range;
			if (!range) return undefined;
			const contents = hovers.flatMap(hover => hover.contents);
			const remote = source?.remote;
			// Untrusted, and only web links: a command a remote returns is dropped, never run in the window.
			return { range, contents: remote ? contents.map(content => remote.refusals.markdown(content)) : contents };
		});
	}

	private async locations(model: ITextModel, position: Position, token: CancellationToken, kind: "definition" | "type" | "implementation"): Promise<LocationLink[] | undefined> {
		return this.withSource(model, position, token, async (local, at, pinned, source) => {
			const registry = this.registry(source);
			const results = kind === "definition" ? await getDefinitionsAtPosition(registry.definitionProvider, local, at, false, token)
				: kind === "type" ? await getTypeDefinitionsAtPosition(registry.typeDefinitionProvider, local, at, false, token)
				: await getImplementationsAtPosition(registry.implementationProvider, local, at, false, token);
			return this.reviewLocations(pinned, results, token, source);
		});
	}

	/** Keep navigation in the same saved version/side only when destination contents match. */
	private async reviewLocations<T extends LocationLink>(pinned: ITextModel, locations: T[], token: CancellationToken, source?: LocalSource): Promise<T[]> {
		if (![REVIEW_API_SOURCE_SCHEME, REVIEW_LANGUAGE_SOURCE_SCHEME].includes(pinned.uri.scheme)) return locations;
		if (!source) return [];
		const prefix = source.root.path.replace(/\/$/, "") + "/";
		// References often share a file. Resolve and compare each destination once per request.
		const groups = new Map<string, T[]>();
		for (const location of locations) {
			const key = location.uri.toString();
			const group = groups.get(key) ?? [];
			group.push(location);
			groups.set(key, group);
		}
		const mapped = new Map<T, T>();
		await Promise.all([...groups.values()].map(async group => {
			const target = group[0].uri;
			const remote = source.remote;
			if (remote ? !ownsRemoteResource(remote.host.authority, target) : target.scheme !== "file") return;
			const inside = (remote || target.authority === source.root.authority) && target.path.startsWith(prefix);
			// Elsewhere on the host, such as a library, it opens read-only through vscode-remote, labelled with the host.
			const onHost = () => { for (const location of group) mapped.set(location, location); };
			if (remote && !inside) return onHost();
			const owned = new DisposableStore();
			try {
				const local = owned.add(await this.models.createModelReference(target)).object.textEditorModel;
				await this.textFiles.files.resolve(target, { reload: { async: false } });
				let original: ITextModel | undefined;
				if (inside) {
					const candidate = pinned.uri.with({ scheme: REVIEW_API_SOURCE_SCHEME, path: "/" + target.path.slice(prefix.length) });
					try { original = owned.add(await this.models.createModelReference(candidate)).object.textEditorModel; }
					catch { /* Dependencies and generated files may have no review counterpart. */ }
				}
				if (remote && (!original || !sameSource(original, local))) return onHost();
				if (!original || !sameSource(original, local)) {
					const candidate = pinned.uri.with({ scheme: REVIEW_LANGUAGE_SOURCE_SCHEME, path: target.path });
					original = owned.add(await this.models.createModelReference(candidate)).object.textEditorModel;
				}
				const destination = original;
				const results = await withCurrentLocalContext([original, local], token, () => this.generation, async () => {
					if (!sameSource(destination, local)) return [];
					return group.map(location => [location, { ...location, uri: destination.uri }] as const);
				});
				for (const [before, after] of results ?? []) mapped.set(before, after);
			} catch {
				// Missing destinations cannot be presented at the provider's coordinates.
			} finally {
				owned.dispose();
			}
		}));
		return locations.flatMap(location => {
			const match = mapped.get(location);
			return match ? [match] : [];
		});
	}

	override dispose(): void {
		this.environments.invalidate();
		for (const entry of this.sources.values()) void entry.pending.then(source => source?.dispose());
		this.sources.clear();
		super.dispose();
	}
}

registerWorkbenchContribution2(ReviewLocalLanguageFeatures.ID, ReviewLocalLanguageFeatures, WorkbenchPhase.BlockRestore);

/** Git for Windows checks the pinned tree out with CRLF (core.autocrlf), and line endings never move a position. */
function sameSource(review: ITextModel, local: ITextModel): boolean {
	if (review.getEOL() === local.getEOL()) return review.equalsTextBuffer(local.getTextBuffer());
	return review.getLineCount() === local.getLineCount() && review.getValue(EndOfLinePreference.LF) === local.getValue(EndOfLinePreference.LF);
}
