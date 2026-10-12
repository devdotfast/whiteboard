import {
  type EditorState,
  type Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";

import {
  type BlockJSON,
  type Board,
  type SavedBlock,
  docToBoard,
} from "./board-doc";
import { applyVersion, editedBlocks } from "./merge";
import { REMOTE, focusedBlock, withKeys } from "./structure";

// Everything a person types on a board until it is saved: the one module
// that owns it. Typing settles, then saves against the version the editor
// last saw. Another author's version merges in around what isn't saved. The
// server may store a save in its own spelling (a link respelled, a short
// commit id written out): the editor takes that version of every block it
// saved, so a saved block never looks unsaved. The block left with unsaved
// typing stays held, so no agent edits it, until its save lands. Closing keeps trying for a while and then keeps the typing to
// bring back; a closing window waits for every board's save.
//
// The editor feeds it every transaction and focus change through `tell`,
// and builds itself from `initial`. A `BoardTransport` carries everything
// else: saves, reads, holds, the window's shutdown and the kept typing.

export interface SaveRequest {
  baseVersion: number;
  title: string;
  document: SavedBlock[];
}

/** Typing a close couldn't save, with the version it was typed on, so it
 * merges onto whatever came after rather than replacing it. */
export interface KeptTyping extends SaveRequest {
  /** The board as of `baseVersion`. */
  base: Board;
}

export interface SaveResponse {
  version: number;
  /** The id each new block got, by its client key. */
  ids: Record<string, string>;
}

export interface VersionedBoard extends Board {
  version: number;
  /** On a person's version: the id each new block got, by its key. */
  personEdit?: { ids?: Record<string, string> };
}

export type SaveStatus = "saved" | "saving" | "failed";

/** Thrown by a transport's `save` when the board moved on past the
 * request's base. Any other error is a failure to retry. */
export class SaveConflict extends Error {}

/** Where a board's saves, holds and kept typing go: the server, or a test's
 * stand-in for it. */
export interface BoardTransport {
  save(request: SaveRequest): Promise<SaveResponse>;
  /** The board's current version. */
  read(): Promise<VersionedBoard>;
  /** The block the person is in (null for none), latest call wins; with
   * `open: false`, that the board closed. Failures are the transport's. */
  hold(blockId: string | null, open?: boolean): void;
  /** Calls `flush` when the window is closing; the window waits for the
   * promise it returns. Returns how to stop. */
  shutdowns(flush: () => Promise<void>): () => void;
  /** Typing a closing board couldn't save, to bring back next time. */
  keep(kept: KeptTyping): void;
  /** Typing kept from an earlier close, removed as it is taken. */
  take(): KeptTyping | undefined;
}

/** What happened in the editor, in order. */
export type BoardEvent =
  /** A transaction the editor applied. */
  | { tr: Transaction }
  | { focused: boolean }
  /** A version from the board's stream. */
  | { version: VersionedBoard }
  /** Try saving again after saving failed. */
  | "retry";

export interface BoardSync {
  /** What to build the editor from: kept typing, or the board. */
  readonly initial: Board;
  tell(event: BoardEvent): void;
  /** Saves everything typed, trying for about ten seconds, then keeps
   * what it couldn't save and lets go of the board. Never rejects. */
  close(): Promise<void>;
}

const SETTLE_MS = 800;

const RETRY_MS = [1_000, 2_000, 4_000];

/** How long a closing board keeps trying, about ten seconds in all. */
const CLOSE_RETRY_MS = [250, 500, 1_000, 2_000, 2_000, 2_000, 2_000];

export function openBoardSync(o: {
  board: VersionedBoard;
  transport: BoardTransport;
  editor: { state(): EditorState; dispatch(tr: Transaction): void };
  onStatus(status: SaveStatus): void;
}): BoardSync {
  return new Sync(o.board, o.transport, o.editor, o.onStatus);
}

const same = (a: Board, b: Board) =>
  a.title === b.title &&
  JSON.stringify(a.document) === JSON.stringify(b.document);

/** The saved board as the server stores it: new blocks carry their ids. */
function named(blocks: SavedBlock[], ids: Record<string, string>): BlockJSON[] {
  return blocks.map(({ clientKey, ...block }) => {
    const out: SavedBlock =
      clientKey && ids[clientKey] ? { ...block, id: ids[clientKey] } : block;

    if (out.type === "section")
      return { ...out, children: named(out.children!, ids) };

    return out;
  });
}

/** The client keys a save names. */
function clientKeys(
  blocks: SavedBlock[],
  into = new Set<string>(),
): Set<string> {
  for (const block of blocks) {
    if (block.clientKey) into.add(block.clientKey);

    clientKeys(block.children ?? [], into);
  }

  return into;
}

class Sync implements BoardSync {
  readonly initial: Board;
  private base: Board;
  private version: number;
  private incoming: VersionedBoard | undefined;
  /** The save on its way: the edits it carries, the keys it names, and
   * the board it sent. */
  private sending:
    | { edits: number; keys: Set<string>; board: Board }
    | undefined;
  private running: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  /** Edits the person made, and how many of them are saved. */
  private edits = 0;
  private savedEdits = 0;
  /** The state the board closed with, once it is closing. */
  private closedState: EditorState | undefined;
  private closing: Promise<void> | undefined;
  private done = false;
  private focused = false;
  /** The block left with unsaved typing: held until its save lands. */
  private leaving: string | null = null;
  /** The block the caret was in, as of the last event. */
  private caret: string | null = null;
  private readonly stopShutdowns: () => void;

  constructor(
    board: VersionedBoard,
    private readonly transport: BoardTransport,
    private readonly editor: {
      state(): EditorState;
      dispatch(tr: Transaction): void;
    },
    private readonly onStatus: (status: SaveStatus) => void,
  ) {
    this.base = { title: board.title, document: board.document };
    this.version = board.version;

    const kept = transport.take();

    if (kept) {
      // Typing brought back stands on the version it was typed on; any
      // newer one merges in before it saves, as a conflict's would.
      this.base = kept.base;
      this.version = kept.baseVersion;
      this.initial = { title: kept.title, document: kept.document };

      if (board.version > kept.baseVersion) this.incoming = board;
      this.changed();
    } else this.initial = this.base;

    this.stopShutdowns = transport.shutdowns(
      () => this.closing ?? this.flush(),
    );
  }

  tell(event: BoardEvent) {
    if (this.closedState) return;

    if (event === "retry") {
      this.failures = 0;
      void this.flush();

      return;
    }

    if ("version" in event) {
      this.receive(event.version);

      return;
    }

    if ("focused" in event) {
      this.focusChanged(event.focused);

      return;
    }

    if (event.tr.docChanged && !event.tr.getMeta(REMOTE)) this.changed();

    const now = focusedBlock(this.state());

    if (now === this.caret) return;
    const was = this.caret;

    this.caret = now;

    if (this.focused) this.moveHold(was, now);
  }

  close(): Promise<void> {
    this.closing ??= this.closeNow();

    return this.closing;
  }

  // The hold.

  private focusChanged(focused: boolean) {
    this.focused = focused;
    this.caret = focusedBlock(this.state());

    if (focused) {
      if (!this.leaving) this.transport.hold(this.caret);

      return;
    }

    // Leaving the editor with unsaved typing keeps that block held until
    // its save lands, as moving to another block does.
    if (this.caret && this.edited().has(this.caret)) this.leaving = this.caret;
    else {
      this.leaving = null;
      this.transport.hold(null);
    }

    void this.flush();
  }

  private moveHold(was: string | null, now: string | null) {
    if (!this.leaving && was && this.edited().has(was)) this.leaving = was;

    if (this.leaving) void this.flush();
    else this.transport.hold(now);
  }

  /** A save landed or a version merged: the left block, once saved, lets
   * the hold move on. */
  private settled() {
    if (!this.leaving || this.edited().has(this.leaving)) return;
    this.leaving = null;
    this.transport.hold(this.focused ? this.caret : null);
  }

  // Saving.

  private state() {
    return this.closedState ?? this.editor.state();
  }

  private dispatch(tr: Transaction) {
    if (this.closedState) this.closedState = this.closedState.apply(tr);
    else this.editor.dispatch(tr);
  }

  private changed() {
    this.edits++;
    this.onStatus("saving");
    this.schedule(SETTLE_MS);
  }

  private get dirty() {
    return this.edits !== this.savedEdits;
  }

  private edited(): Set<string> {
    return editedBlocks(this.state(), this.base);
  }

  /** Save now, after any save already on its way. */
  private flush(): Promise<void> {
    this.unschedule();
    this.running = this.running.then(() => this.save());

    return this.running;
  }

  private async closeNow(): Promise<void> {
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    this.closedState = this.editor.state();
    await this.flush();

    for (const ms of CLOSE_RETRY_MS) {
      if (!this.dirty) break;
      // A save refused for a newer version goes again once that merges in.
      await wait(ms);
      this.failures = 0;
      await this.flush();
    }

    this.done = true;
    this.unschedule();

    if (this.dirty) {
      const board = this.pending();

      if (board)
        this.transport.keep({
          baseVersion: this.version,
          base: this.base,
          ...board,
        });
    }

    this.stopShutdowns();
    this.transport.hold(null, false);
  }

  private schedule(ms: number) {
    this.unschedule();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, ms);
  }

  private unschedule() {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** A version from the stream, or read after a refused save: another
   * author's, or our own save, which may arrive before its answer, or
   * instead of a lost one. */
  private receive(board: VersionedBoard) {
    // New blocks it names take their ids, so they are never added twice.
    if (board.personEdit?.ids) this.tag(board.personEdit.ids);

    if (board.version < this.version) return;

    // Our own save, or the version we have: it becomes the base, but only
    // the save's own answer says the typing it carried is saved. The editor
    // takes the server's spelling of what it sent.
    if (board.version === this.version || this.ours(board)) {
      const sent = this.ours(board)
        ? {
            title: this.sending!.board.title,
            document: named(
              this.sending!.board.document,
              board.personEdit?.ids ?? {},
            ),
          }
        : this.base;

      this.adopt(sent, board);
      this.base = { title: board.title, document: board.document };
      this.version = board.version;
      this.settled();

      return;
    }

    this.incoming = board;
    this.drain();
  }

  /**
   * The server's version of what the editor `sent`, in place of it, kept
   * out of the undo history, the caret where it was. A block typed in since
   * it was sent keeps the typing; its next save carries it, and the server's
   * spelling comes back with that save's version. Nothing else changes.
   */
  private adopt(sent: Board, stored: Board) {
    if (same(sent, stored)) return;
    const state = this.state();
    const tr = applyVersion(state, sent, stored);

    if (!tr) return;
    this.dispatch(tr.setSelection(keptSelection(state, tr)));
  }

  /** Whether a version is the save on its way: a person's, the next one,
   * naming only keys the save named. */
  private ours(board: VersionedBoard) {
    if (!board.personEdit) return false;
    const ids = Object.keys(board.personEdit.ids ?? {});

    return (
      this.sending !== undefined &&
      board.version === this.version + 1 &&
      ids.every((key) => this.sending!.keys.has(key))
    );
  }

  private drain() {
    if (this.sending || !this.incoming) return;
    const next = this.incoming;
    this.incoming = undefined;
    const state = this.state();

    const tr = applyVersion(
      state,
      this.base,
      next,
      this.closedState ? null : focusedBlock(state),
    );

    if (tr) this.dispatch(tr);
    this.base = { title: next.title, document: next.document };
    this.version = next.version;

    if (this.dirty) this.schedule(0);
    else this.onStatus("saved");

    this.settled();
  }

  /** The board the document would save as, when it differs from the base. */
  private pending() {
    const keyed = withKeys(this.state());

    if (keyed) this.dispatch(keyed);

    const board = docToBoard(this.state().doc, this.base);

    return same(board, this.base) ? undefined : board;
  }

  private async save(): Promise<void> {
    if (this.sending || this.done || !this.dirty) return;
    // A version waiting to merge goes in first: a save never replaces it.
    this.drain();
    const edits = this.edits;
    const board = this.pending();

    if (!board) {
      this.savedEdits = edits;
      this.onStatus("saved");
      this.settled();

      return;
    }

    this.sending = { edits, keys: clientKeys(board.document), board };
    this.onStatus("saving");
    let retry: number | undefined;
    let failed = false;

    try {
      const response = await this.transport.save({
        baseVersion: this.version,
        ...board,
      });

      this.failures = 0;
      this.tag(response.ids);

      // The stream may have brought this version already.
      if (response.version > this.version) {
        this.base = {
          title: board.title,
          document: named(board.document, response.ids),
        };
        this.version = response.version;
      }

      this.savedEdits = Math.max(this.savedEdits, edits);
    } catch (error) {
      // On a conflict the newer version merges in, from the stream or read
      // here (a closed board has no stream), and the save goes again.
      if (error instanceof SaveConflict)
        void this.transport.read().then(
          (latest) => this.receive(latest),
          () => {},
        );
      else {
        retry = RETRY_MS[this.failures++];
        failed = retry === undefined;
      }
    } finally {
      this.sending = undefined;
    }

    if (this.incoming) this.drain();
    else if (!this.dirty) this.onStatus("saved");
    else if (retry !== undefined) this.schedule(retry);
    else if (failed) this.onStatus("failed");
    else this.schedule(SETTLE_MS);

    this.settled();
  }

  /** New blocks take the ids the server gave them, by their keys. */
  private tag(ids: Record<string, string>) {
    const named = new Map(Object.entries(ids));

    if (!named.size) return;
    const state = this.state();
    const tr = state.tr.setMeta("addToHistory", false).setMeta(REMOTE, true);

    state.doc.forEach((node, pos) => {
      const id = node.attrs.key ? named.get(node.attrs.key) : undefined;

      if (!id) return;
      tr.setNodeAttribute(pos, "id", id).setNodeAttribute(pos, "key", null);

      // A rich block carries its id in its stored fields too.
      if (node.attrs.json)
        tr.setNodeAttribute(pos, "json", { ...node.attrs.json, id });
    });

    if (tr.docChanged) this.dispatch(tr);
  }
}

/** The selection a block's replacement would lose, at the same distance
 * into the block that now stands where it did. */
function keptSelection(state: EditorState, tr: Transaction): Selection {
  const { selection } = state;

  if (!(selection instanceof TextSelection))
    return selection.map(tr.doc, tr.mapping);

  const place = (pos: number) => {
    const $pos = state.doc.resolve(pos);

    if ($pos.depth < 1) return tr.mapping.map(pos);
    const start = $pos.before(1);
    const at = tr.mapping.map(start, -1);
    const node = tr.doc.nodeAt(at);

    return node
      ? Math.min(at + (pos - start), at + node.nodeSize - 1)
      : tr.mapping.map(pos);
  };

  return TextSelection.between(
    tr.doc.resolve(place(selection.anchor)),
    tr.doc.resolve(place(selection.head)),
  );
}
