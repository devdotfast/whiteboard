/// <reference lib="webworker" />
/** Runs diffr off the main thread: one engine, one request at a time, in order. The page sends work only once it is ready. */
import type { StructuralDiffEvent } from "../protocol.js";
import init, { Differ } from "../wasm/diffr_web.js";

/** A file as the classifier sees it: its tags, and why it starts hidden. */
export interface Classified {
  tags: string[];
  hidden?: string;
}

export type FileEvent = Extract<StructuralDiffEvent, { type: "file" }>;

/** The first message carries the compiled module and the configuration; every later one is work. */
export type Request =
  | { module: WebAssembly.Module; config: string | undefined }
  | { id: number; diff: string }
  | { id: number; preview: string };

interface Usage {
  id: number;
  ms: number;
  /** Bytes of wasm memory, which never shrinks. */
  memory: number;
}

export type Response =
  | { ready: number; notices: string[] }
  | { failed: string }
  | (Usage & { classified: Classified; event: FileEvent })
  | (Usage & { previews: (Classified | { error: string })[] })
  | (Usage & { error: string });

interface WireClassified {
  entry: { tags?: string[] };
  hidden?: string;
}

let differ: Differ | undefined;

let memory: WebAssembly.Memory | undefined;

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if ("module" in data) {
    const start = performance.now();

    try {
      const wasm = await init({ module_or_path: data.module });
      memory = wasm.memory;
      differ = new Differ(data.config);
      self.postMessage({
        ready: performance.now() - start,
        notices: JSON.parse(differ.notices()),
      } satisfies Response);
    } catch (error) {
      self.postMessage({
        failed: error instanceof Error ? error.message : String(error),
      } satisfies Response);
    }

    return;
  }

  handle(data);
};

function handle(data: Request): void {
  if ("module" in data) return;
  const start = performance.now();

  const usage = () => ({
    id: data.id,
    ms: performance.now() - start,
    memory: memory?.buffer.byteLength ?? 0,
  });

  try {
    if ("preview" in data) {
      // SAFETY: Differ.preview returns an array of these, one per file (diffr-web's lib.rs).
      const previews = (
        JSON.parse(differ!.preview(data.preview)) as (
          | WireClassified
          | { error: string }
        )[]
      ).map((preview) =>
        "error" in preview
          ? preview
          : { tags: preview.entry.tags ?? [], hidden: preview.hidden },
      );

      self.postMessage({ ...usage(), previews } satisfies Response);

      return;
    }

    // SAFETY: Differ.diff returns the classified entry and its record (diffr-web's lib.rs).
    const response = JSON.parse(differ!.diff(data.diff)) as WireClassified & {
      event: FileEvent;
    };

    self.postMessage({
      ...usage(),
      classified: { tags: response.entry.tags ?? [], hidden: response.hidden },
      event: response.event,
    } satisfies Response);
  } catch (error) {
    self.postMessage({
      ...usage(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies Response);
  }
}
