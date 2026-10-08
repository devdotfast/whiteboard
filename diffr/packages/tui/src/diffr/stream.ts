import { parseDiffEvents } from "./events";
import type { DiffEvent } from "./wire";
export async function* readDiffStream(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<DiffEvent> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  async function* texts() {
    for await (const chunk of chunks) yield decoder.decode(chunk, { stream: true });
    yield decoder.decode();
  }
  yield* parseDiffEvents(texts());
}
