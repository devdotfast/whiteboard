/**
 * The page's handle on diffr: the wasm module is fetched and compiled once, then handed to a pool
 * of workers, so files diff in parallel without each worker paying for its own compile. The pool
 * starts at one and grows while work queues, a worker at a time: each spends a second or two
 * compiling diffr's queries, and workers starting together slow each other several times over.
 * All but one go after ten idle seconds, since wasm memory never shrinks.
 */
// Gzipped by the build (vite.config.ts): static hosts cap a file at 25 MiB, and the engine is larger.
import wasmUrl from "../wasm/diffr_web_bg.wasm.gz?url";
import type { Classified, FileEvent, Request, Response } from "./worker.js";

export type { Classified, FileEvent };

/** One side of a file, named as diffr's classifier reads it. */
export interface Side {
  path: string;
  oid: string;
  mode: string;
  text?: string;
}

export interface FileRequest {
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
  lhs?: Side;
  rhs?: Side;
}

export interface Diffed {
  classified: Classified;
  event: FileEvent;
  ms: number;
}

/** What the engine panel shows. */
export interface EngineStats {
  /** Most workers the pool grows to. */
  maxWorkers: number;
  workers: number;
  busy: number;
  /** Milliseconds from page start until the module was compiled. */
  compiled?: number;
  /** Milliseconds a worker took to load the module and the configuration. */
  ready?: number;
  bytes: number;
  /** The largest wasm memory any worker holds. */
  memory: number;
  diffed: number;
  diffMs: number;
}

const MAX_WORKERS = Math.max(
  1,
  Math.min(8, (navigator.hardwareConcurrency || 4) - 1),
);

const IDLE_MS = 10_000;

/** Past this, a worker is replaced once its queue drains. */
const MEMORY_LIMIT = 1024 * 1024 * 1024;

const stats: EngineStats = {
  maxWorkers: MAX_WORKERS,
  workers: 0,
  busy: 0,
  bytes: 0,
  memory: 0,
  diffed: 0,
  diffMs: 0,
};

const listeners = new Set<() => void>();

export function engineStats(): Readonly<EngineStats> {
  return stats;
}

export function onEngineChange(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

const changed = () => listeners.forEach((listener) => listener());

/**
 * The engine's bytes, unpacked as they arrive so compiling still streams. A server that sent the
 * file with `Content-Encoding: gzip` has unpacked it already, so the first bytes decide.
 */
async function unpacked(
  response: globalThis.Response,
): Promise<globalThis.Response> {
  const [peek, body] = response.body!.tee();
  const reader = peek.getReader();
  const { value } = await reader.read();
  void reader.cancel();
  const gzipped = !!value && value[0] === 0x1f && value[1] === 0x8b;

  const stream = gzipped
    ? body.pipeThrough(new DecompressionStream("gzip"))
    : body;

  return new globalThis.Response(stream, {
    headers: { "content-type": "application/wasm" },
  });
}

let compiled: Promise<WebAssembly.Module> | undefined;

function module(): Promise<WebAssembly.Module> {
  return (compiled ??= (async () => {
    const response = await fetch(wasmUrl);

    if (!response.ok)
      throw new Error(`The diffr engine failed to load (${response.status}).`);
    stats.bytes = Number(response.headers.get("content-length")) || 0;
    const module = await WebAssembly.compileStreaming(await unpacked(response));
    stats.compiled = performance.now();
    changed();

    return module;
  })());
}

interface Call {
  resolve(response: Response): void;
  reject(error: Error): void;
}

interface Slot {
  worker: Worker;
  busy: number;
  retire: boolean;
  ready: boolean;
}

/** A pool of diffr workers, all with one configuration. */
export class Engine {
  private readonly slots: Slot[] = [];
  private readonly pending = new Map<number, Call>();
  /** Jobs no worker has taken yet. */
  private readonly queue: Request[] = [];
  private next = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private failure: Error | undefined;
  /** What the configuration asked for that the browser does not run. */
  readonly notices: Promise<string[]>;
  private resolveNotices!: (notices: string[]) => void;
  private rejectNotices!: (error: Error) => void;

  constructor(private readonly config: string | undefined) {
    this.notices = new Promise((resolve, reject) => {
      this.resolveNotices = resolve;
      this.rejectNotices = reject;
    });
    this.notices.catch(() => {});
    this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const slot: Slot = {
      worker: new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      }),
      busy: 0,
      retire: false,
      ready: false,
    };

    stats.workers++;
    module().then(
      (module) =>
        slot.worker.postMessage({
          module,
          config: this.config,
        } satisfies Request),
      (error: Error) => this.fail(error),
    );
    slot.worker.onmessage = ({ data }: MessageEvent<Response>) =>
      this.receive(slot, data);
    slot.worker.onerror = (event) =>
      this.fail(new Error(event.message || "A diffr worker failed to start."));
    changed();

    return slot;
  }

  private receive(slot: Slot, data: Response): void {
    if ("ready" in data) {
      slot.ready = true;
      stats.ready ??= data.ready;
      this.resolveNotices(data.notices);
      this.dispatch();
      changed();

      return;
    }

    if ("failed" in data) {
      this.fail(new Error(data.failed));

      return;
    }

    slot.busy--;
    stats.busy--;
    stats.memory = Math.max(stats.memory, data.memory);

    if (data.memory > MEMORY_LIMIT) slot.retire = true;

    if (slot.retire && !slot.busy) this.replace(slot);
    const call = this.pending.get(data.id)!;
    this.pending.delete(data.id);

    if ("error" in data) call.reject(new Error(data.error));
    else call.resolve(data);
    this.dispatch();

    if (!stats.busy && !this.queue.length) this.scheduleIdle();
    changed();
  }

  private replace(slot: Slot): void {
    slot.worker.terminate();
    stats.workers--;
    this.slots.splice(this.slots.indexOf(slot), 1, this.spawn());
  }

  /** The configuration or the engine failed: every call fails with it. */
  private fail(error: Error): void {
    this.failure = error;
    this.rejectNotices(error);

    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
    this.queue.length = 0;
  }

  private scheduleIdle(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      for (const slot of this.slots.splice(1)) {
        if (slot.busy) this.slots.push(slot);
        else {
          slot.worker.terminate();
          stats.workers--;
        }
      }

      changed();
    }, IDLE_MS);
  }

  /**
   * Queued jobs to ready workers, two each so none waits on the page between jobs. When every
   * ready worker is full and none is starting, another starts. A retiring worker takes nothing
   * new, so it drains and goes.
   */
  private dispatch(): void {
    while (this.queue.length) {
      const slot = this.slots.find(
        (slot) => slot.ready && !slot.retire && slot.busy < 2,
      );

      if (!slot) {
        if (
          this.slots.every((slot) => slot.ready) &&
          this.slots.length < MAX_WORKERS
        )
          this.slots.push(this.spawn());

        return;
      }

      const job = this.queue.shift()!;
      slot.busy++;
      stats.busy++;
      slot.worker.postMessage(job);
    }
  }

  private send<T extends Response>(
    message: (id: number) => Request,
  ): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    clearTimeout(this.idle);
    const id = this.next++;

    return new Promise<T>((resolve, reject) => {
      // SAFETY: the worker answers this id with the response kind its request asks for.
      this.pending.set(id, { resolve: resolve as Call["resolve"], reject });
      this.queue.push(message(id));
      this.dispatch();
      changed();
    });
  }

  /** Diff one file. Resolves with its classification, its record and the time it took. */
  async diff(file: FileRequest): Promise<Diffed> {
    const response = await this.send<Extract<Response, { event: FileEvent }>>(
      (id) => ({
        id,
        diff: JSON.stringify({ ...file, syntax: true }),
      }),
    );

    stats.diffed++;
    stats.diffMs += response.ms;

    return {
      classified: response.classified,
      event: response.event,
      ms: response.ms,
    };
  }

  /** Classify files from their paths alone, before any source is fetched. In the order asked. */
  async preview(
    files: readonly FileRequest[],
  ): Promise<(Classified | { error: string })[]> {
    const response = await this.send<Extract<Response, { previews: unknown }>>(
      (id) => ({
        id,
        preview: JSON.stringify(files),
      }),
    );

    return response.previews;
  }

  dispose(): void {
    clearTimeout(this.idle);

    for (const slot of this.slots.splice(0)) {
      slot.worker.terminate();
      stats.workers--;
      stats.busy -= slot.busy;
    }

    for (const call of this.pending.values())
      call.reject(new Error("The engine was stopped."));
    this.pending.clear();
    this.queue.length = 0;
    changed();
  }
}
