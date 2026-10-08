import type { Comparison } from "./process";

export const openDescription = "Open a Diffr comparison in the person's terminal for review. Pass git diff arguments as an array, without shell quoting. This does not send a chat message or apply changes. Requires an attached interactive terminal.";

/** A mounted pane is not proof that the producer accepted the comparison. */
export async function opened(comparison: Comparison, signal?: AbortSignal): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error("Diffr open cancelled."));
    const check = (ended = false) => {
      const state = comparison.store.getSnapshot();
      if (state.errors.length) finish(new Error(state.errors.join("\n")));
      else if (state.comparison) finish();
      else if (ended || state.complete) finish(new Error("Diffr ended without a comparison."));
    };
    const timer = setTimeout(() => finish(new Error("Diffr did not start a comparison within 15 seconds.")), 15_000);
    unsubscribe = comparison.store.subscribe(check);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else check();
    void comparison.done.then(() => check(true));
  });
  return `Opened Diffr for review: ${comparison.store.getSnapshot().inventory.length} changed files. The person's chat draft was not sent.`;
}
