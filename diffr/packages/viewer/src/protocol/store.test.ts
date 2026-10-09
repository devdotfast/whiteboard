import { expect, test } from "vitest";
import { DiffStore } from "./store";
import { createTestDiffFile, startFor } from "./fixture";

test("a burst of streamed files publishes one complete snapshot", async () => {
  const store = new DiffStore();
  const files = Array.from({ length: 226 }, (_, i) => {
    const file = createTestDiffFile();
    file.file.rhs!.path = `file${i}.ts`;
    return file;
  });
  const snapshots: ReturnType<DiffStore["getSnapshot"]>[] = [];
  const published = new Promise<void>(resolve => {
    store.subscribe(() => { snapshots.push(store.getSnapshot()); resolve(); });
  });
  const initial = store.getSnapshot();
  store.accept(startFor(files));
  files.forEach(file => store.accept(file));
  store.accept({ type: "complete", succeeded: 226, failed: 0 });
  expect(snapshots).toHaveLength(0);
  expect(initial.loaded).toBe(0);
  await published;
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0].loaded).toBe(226);
  expect(snapshots[0].complete).toBe(true);

  const failed = new Promise<void>(resolve => {
    const unsubscribe = store.subscribe(() => { unsubscribe(); resolve(); });
  });
  store.fail("subprocess failed");
  await failed;
  expect(snapshots).toHaveLength(2);
  expect(snapshots[1].errors).toEqual(["subprocess failed"]);
  expect(snapshots[0].errors).toEqual([]);
});

test("an unsubscribed viewer is not notified by a pending batch", async () => {
  const store = new DiffStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  store.fail("stopped");
  unsubscribe();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(calls).toBe(0);
});
