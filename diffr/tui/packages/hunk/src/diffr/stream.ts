/** Decode stdout incrementally. diffr's records are trusted as sent: only malformed JSON, an
 * unknown protocol version, and a stream that ends before `complete` are errors. */
import { eventSchema, type DiffEvent } from "./wire";
export async function* readDiffStream(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<DiffEvent> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    complete = false;
  function parse(line: string): DiffEvent {
    if (line.length > 128 * 1024 * 1024)
      throw new Error("diffr event exceeds 128 MiB");
    const event = eventSchema.parse(JSON.parse(line));
    // A stream cut short, say by a signal, ends without `complete`.
    if (event.type === "complete") complete = true;
    return event;
  }
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim()) yield parse(line);
    }
    if (buffer.length > 128 * 1024 * 1024)
      throw new Error("diffr event exceeds 128 MiB");
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield parse(buffer);
  if (!complete) throw new Error("Incomplete diffr stream");
}
