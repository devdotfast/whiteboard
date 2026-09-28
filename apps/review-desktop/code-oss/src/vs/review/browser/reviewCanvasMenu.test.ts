import assert from "node:assert/strict";
import test from "node:test";
import type { IContextMenuDelegate } from "../../base/browser/contextmenu.js";
import type { ReviewMenuRequest } from "../common/reviewProtocol.js";
import { showReviewCanvasMenu } from "./reviewCanvasMenu.js";

function setup() {
  let delegate!: IContextMenuDelegate;
  let current = true;
  let connected = true;
  let hides = 0;
  let focuses = 0;
  const selected: string[] = [];
  const doc = { body: {}, activeElement: undefined as unknown };
  doc.activeElement = doc.body;
  const anchor = { get isConnected() { return connected; }, ownerDocument: doc, focus() { focuses++; } } as unknown as HTMLElement;
  const request: ReviewMenuRequest = {
    anchor,
    items: [{ id: "one", label: "One", checked: true }, { id: "two", label: "Two", enabled: false }],
    onSelect: id => { selected.push(id); },
    onHide: () => { hides++; },
  };
  const menu = showReviewCanvasMenu({ showContextMenu: value => { delegate = value as IContextMenuDelegate; } }, request, () => current);
  return { menu, delegate, selected, request, doc, stale: () => { current = false; }, detach: () => { connected = false; }, counts: () => ({ hides, focuses }) };
}

test("hide before selection dispatches once without stealing action focus", async () => {
  const s = setup();
  s.delegate.onHide?.(false);
  await s.delegate.getActions()[0]!.run();
  await s.delegate.getActions()[0]!.run();
  s.delegate.onHide?.(false);
  await Promise.resolve();
  assert.deepEqual(s.selected, ["one"]);
  assert.deepEqual(s.counts(), { hides: 1, focuses: 0 });
});

test("native cancellation (reported as false) restores trigger focus and expires actions", async () => {
  const s = setup();
  s.delegate.onHide?.(false);
  await Promise.resolve();
  await s.delegate.getActions()[0]!.run();
  assert.deepEqual(s.selected, []);
  assert.deepEqual(s.counts(), { hides: 1, focuses: 1 });
});

test("cancellation does not steal focus from a different control", async () => {
  const s = setup();
  s.doc.activeElement = { closest: () => null };
  s.delegate.onHide?.(true);
  await Promise.resolve();
  assert.equal(s.counts().focuses, 0);
});

test("disabled, detached, disposed and old-canvas actions are ignored", async () => {
  const disabled = setup();
  await disabled.delegate.getActions()[1]!.run();
  assert.deepEqual(disabled.selected, []);
  for (const invalidate of ["detach", "stale", "dispose"] as const) {
    const s = setup();
    if (invalidate === "dispose") s.menu.dispose();
    else s[invalidate]();
    await s.delegate.getActions()[0]!.run();
    s.delegate.onHide?.(true);
    await Promise.resolve();
    assert.deepEqual(s.selected, []);
    assert.equal(s.counts().focuses, 0);
    assert.equal(s.counts().hides, invalidate === "dispose" ? 0 : 1);
  }
});

test("an action failure reaches the host notification handler", async () => {
  const s = setup();
  s.request.onSelect = async () => { throw new Error("Failed action"); };
  await assert.rejects(async () => { await s.delegate.getActions()[0]!.run(); }, /Failed action/);
});
