import type { BlockJSON, Board, SavedBlock } from "./board-doc";
import {
  type BoardTransport,
  type KeptTyping,
  SaveConflict,
  type SaveRequest,
  type SaveResponse,
  type VersionedBoard,
} from "./sync";

// A board's server in memory: the second adapter at the board-sync seam,
// for tests. It keeps the board's versions, names new blocks, refuses a save
// on a stale version, records every hold, keeps typing a close couldn't
// save, and lets a test act as another author, answer saves by hand, fail
// them, or close the window. Given `store`, it keeps each saved Markdown in
// its own spelling, as the real store respells links.

export interface MemoryBoardServer {
  /** The board as the server has it now. */
  readonly board: VersionedBoard;
  /** Every save it was sent, answered or not. */
  readonly saves: SaveRequest[];
  /** Every hold: the block, or null; `open: false` when the board closed. */
  readonly holds: { blockId: string | null; open: boolean }[];
  /** Typing kept from a close, by the next `take`. */
  kept: KeptTyping | undefined;
  /** Another author's version: changes the board and returns it, for the
   * test to stream to the editor or not. */
  author(change: (board: VersionedBoard) => void): VersionedBoard;
  /** The next `count` saves fail, as offline. */
  fail(count: number): void;
  /** Saves wait to be answered by `answer()`; with `stored`, the board
   * has each one meanwhile, as when the stream outruns the answer. */
  holdAnswers(options?: { stored?: boolean }): void;
  /** Answers the oldest save waiting. */
  answer(): Promise<void>;
  /** The window closes: every board's flush, and what the window waits on. */
  shutdown(): Promise<void>;
  transport(): BoardTransport;
}

export function memoryBoardServer(
  start: VersionedBoard,
  { store = (markdown: string) => markdown } = {},
): MemoryBoardServer {
  let board = structuredClone(start);
  let failing = 0;
  let manual = false;
  let storedEarly = false;
  let nextId = 100;
  const waiting: (() => void)[] = [];
  const flushes = new Set<() => Promise<void>>();

  const name = (blocks: SavedBlock[], ids: Record<string, string>) =>
    blocks.map(({ clientKey, ...block }): BlockJSON => {
      const id = block.id ?? (clientKey ? `block-${nextId++}` : undefined);

      if (clientKey && id) ids[clientKey] = id;

      return {
        ...block,
        ...(id && { id }),
        ...(block.type === "markdown" && {
          markdown: store(String(block.markdown)),
        }),
        ...(block.children && { children: name(block.children, ids) }),
      };
    });

  const server: MemoryBoardServer = {
    get board() {
      return board;
    },
    saves: [],
    holds: [],
    kept: undefined,
    author(change) {
      const next = structuredClone(board);

      change(next);
      next.version = board.version + 1;
      delete next.personEdit;
      board = next;

      return structuredClone(board);
    },
    fail(count) {
      failing = count;
    },
    holdAnswers({ stored = false } = {}) {
      manual = true;
      storedEarly = stored;
    },
    async answer() {
      waiting.shift()?.();

      // Let the answer reach the board, without waiting on any timer.
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    },
    async shutdown() {
      await Promise.all([...flushes].map((flush) => flush()));
    },
    transport: () => ({
      save(request): Promise<SaveResponse> {
        server.saves.push(request);

        const settle = (): SaveResponse => {
          if (failing > 0) {
            failing--;
            throw new Error("offline");
          }

          if (request.baseVersion !== board.version)
            throw new SaveConflict("The board changed.");

          const ids: Record<string, string> = {};

          board = {
            version: board.version + 1,
            title: request.title,
            document: name(request.document, ids),
            personEdit: { ids },
          };

          return { version: board.version, ids };
        };

        if (!manual) return Promise.resolve().then(settle);

        if (storedEarly) {
          let answer: SaveResponse | Error;

          try {
            answer = settle();
          } catch (error) {
            answer = error instanceof Error ? error : new Error(String(error));
          }

          return new Promise((resolve, reject) =>
            waiting.push(() =>
              answer instanceof Error ? reject(answer) : resolve(answer),
            ),
          );
        }

        return new Promise((resolve, reject) =>
          waiting.push(() => {
            try {
              resolve(settle());
            } catch (error) {
              reject(error);
            }
          }),
        );
      },
      read: async () => structuredClone(board),
      hold(blockId, open = true) {
        server.holds.push({ blockId, open });
      },
      shutdowns(flush) {
        flushes.add(flush);

        return () => flushes.delete(flush);
      },
      keep(kept) {
        server.kept = structuredClone(kept);
      },
      take() {
        const kept = server.kept;

        server.kept = undefined;

        return kept;
      },
    }),
  };

  return server;
}
