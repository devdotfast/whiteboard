import * as z from "zod/mini";

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

/**
 * The first message carries the compiled module, the configuration and the page's overrides of it
 * (JSON); every later one is work. A diff that summarizes waits on a model for each body.
 */
export type Request =
  | {
      module: WebAssembly.Module;
      config: string | undefined;
      overrides: string | undefined;
      /** Agent plugins (settings.ts), run after diffr's own. */
      plugins: { name: string; code: string }[];
    }
  | { id: number; diff: string; summarize?: boolean }
  | { id: number; preview: string }
  | { id: number; schema: true };

interface Usage {
  id: number;
  ms: number;
  /** Bytes of wasm memory, which never shrinks. */
  memory: number;
}

export type Response =
  | { ready: number; notices: string[]; summarizes: boolean }
  | { failed: string }
  | (Usage & {
      classified: Classified;
      event: FileEvent;
      /** Agent plugins that threw on this file, and why. */
      pluginErrors: string[];
    })
  | (Usage & { previews: (Classified | { error: string })[] })
  | (Usage & { schema: string })
  | (Usage & { error: string });

interface WireClassified {
  entry: { tags?: string[] };
  hidden?: string;
}

let differ: Differ | undefined;

type TextDiff = Extract<NonNullable<FileEvent["diff"]>, { type: "text" }>;

type Region = NonNullable<TextDiff["rhs"]>["root"];

/** What an agent plugin is handed: one diffed file, its sides' text and region trees. */
interface AgentFile {
  path: string;
  status: string;
  tags: string[];
  lhs?: { text: string; root: Region };
  rhs?: { text: string; root: Region };
}

/** A plugin edits the file it is handed; what it returns is ignored. */
type AgentFold = (file: AgentFile) => void;

let plugins: { name: string; run: AgentFold }[] = [];

/** What a plugin may have set on a region: the page keeps only this. */
const Visibility = z.object({
  collapsed: z.optional(z.boolean()),
  label: z.optional(z.string()),
});

/**
 * Run the agent's plugins on a diffed file. Each edits a copy; only what it set on a region's
 * `visibility` comes back, and a fold state either side changed changes on both, as diffr's own
 * plugins keep them.
 */
function runPlugins(
  event: FileEvent,
  diff: TextDiff,
  tags: string[],
): string[] {
  const errors: string[] = [];
  const path = event.file.rhs?.path ?? event.file.lhs?.path ?? "";

  for (const { name, run } of plugins) {
    const file: AgentFile = structuredClone({
      path,
      status:
        event.file.rhs && event.file.lhs
          ? "modified"
          : event.file.rhs
            ? "added"
            : "deleted",
      tags,
      lhs: diff.lhs && { text: diff.lhs.text, root: diff.lhs.root },
      rhs: diff.rhs && { text: diff.rhs.text, root: diff.rhs.root },
    });

    try {
      run(file);
    } catch (error) {
      errors.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const changed = new Map<number, { collapsed: boolean; label: string }>();

    const read = (original: Region, edited: Region | undefined) => {
      const visibility = Visibility.safeParse(edited?.visibility);

      if (visibility.success) {
        const before = {
          collapsed: !!original.visibility?.collapsed,
          label: original.visibility?.label ?? "",
        };

        const next = {
          collapsed: visibility.data.collapsed ?? before.collapsed,
          label: visibility.data.label ?? before.label,
        };

        if (next.collapsed !== before.collapsed || next.label !== before.label)
          changed.set(original.fold_state_id, next);
      }

      if (original.kind === "fold" && edited?.kind === "fold")
        original.children.forEach((child, index) =>
          read(child, edited.children?.[index]),
        );
    };

    for (const side of ["lhs", "rhs"] as const)
      if (diff[side]) read(diff[side].root, file[side]?.root);

    const apply = (region: Region) => {
      const next = changed.get(region.fold_state_id);

      if (next) region.visibility = { ...next };

      if (region.kind === "fold") region.children.forEach(apply);
    };

    for (const side of ["lhs", "rhs"] as const)
      if (diff[side]) apply(diff[side].root);
  }

  return errors;
}

/** What diffr asks of the page (diffr-web's plugins.rs): an HTTP POST, or a pause. */
type HostRequest =
  | {
      post: string;
      headers: [string, string][];
      body: string;
      timeout_ms: number;
    }
  | { sleep_ms: number };

/**
 * The summarizer's requests to its model. A linked plugin cannot wait on the page, so these are
 * synchronous, which only a worker may do; the page stays responsive.
 */
function host(text: string): string {
  // SAFETY: diffr-web's PageHttp sends one of these.
  const request = JSON.parse(text) as HostRequest;

  if ("sleep_ms" in request) {
    const until = performance.now() + request.sleep_ms;

    if ("SharedArrayBuffer" in globalThis)
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        request.sleep_ms,
      );
    else while (performance.now() < until);

    return "{}";
  }

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", request.post, false);
    xhr.timeout = request.timeout_ms;

    for (const [name, value] of request.headers) {
      // The browser sets the length itself and refuses to be told it.
      if (name.toLowerCase() !== "content-length")
        xhr.setRequestHeader(name, value);

      // Anthropic answers a browser only when it says it means to call from one.
      if (name.toLowerCase() === "anthropic-version")
        xhr.setRequestHeader(
          "anthropic-dangerous-direct-browser-access",
          "true",
        );
    }

    xhr.send(request.body);

    if (!xhr.status)
      return JSON.stringify({
        error: `${new URL(request.post).host} could not be reached from the browser (offline, or it refuses other sites' pages)`,
      });

    return JSON.stringify({ status: xhr.status, body: xhr.responseText });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

Object.assign(self, { diffrHost: host });

let memory: WebAssembly.Memory | undefined;

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if ("module" in data) {
    const start = performance.now();

    try {
      const wasm = await init({ module_or_path: data.module });
      memory = wasm.memory;
      differ = new Differ(data.config, data.overrides);
      const notices: string[] = JSON.parse(differ.notices());
      plugins = data.plugins.flatMap(({ name, code }) => {
        try {
          const run: unknown = (0, eval)(`(${code}\n)`);

          if (!(run instanceof Function))
            throw new Error("its code is not a function");

          return [{ name, run: (file: AgentFile) => void run(file) }];
        } catch (error) {
          notices.push(
            `The plugin ${name} is skipped: ${error instanceof Error ? error.message : String(error)}`,
          );

          return [];
        }
      });
      self.postMessage({
        ready: performance.now() - start,
        notices,
        summarizes: differ.summarizes(),
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
    if ("schema" in data) {
      self.postMessage({
        ...usage(),
        schema: Differ.schema(),
      } satisfies Response);

      return;
    }

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

    const tags = response.entry.tags ?? [];
    const diff = response.event.diff;

    const pluginErrors =
      diff?.type === "text" && !response.hidden
        ? runPlugins(response.event, diff, tags)
        : [];

    self.postMessage({
      ...usage(),
      classified: { tags, hidden: response.hidden },
      event: response.event,
      pluginErrors,
    } satisfies Response);
  } catch (error) {
    self.postMessage({
      ...usage(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies Response);
  }
}
