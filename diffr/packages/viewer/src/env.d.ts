/** Globals common to Bun, browsers and Claude Code; no Node APIs. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
declare function setTimeout(handler: () => void, timeout?: number): unknown;
