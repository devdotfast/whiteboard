import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import type { DiffEvent } from "@diffr/viewer/protocol/wire";
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
