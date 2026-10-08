import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "./socket";

test("socket client assembles fragmented replies and propagates API errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "diffr-herdr-"));
  const path = join(dir, "api.sock");
  const server = createServer(socket => {
    let input = "";
    socket.on("data", chunk => {
      input += chunk;
      if (!input.includes("\n")) return;
      const req = JSON.parse(input.trim());
      const reply = JSON.stringify(req.method === "fail" ? { id: req.id, error: { message: "pane disappeared" } }
        : { id: req.id, result: { pane: { pane_id: req.params.pane_id } } }) + "\n";
      socket.write(reply.slice(0, 5));
      setTimeout(() => socket.end(reply.slice(5)), 5);
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  try {
    expect(await request<{ pane: { pane_id: string } }>(path, "pane.get", { pane_id: "p1" })).toEqual({ pane: { pane_id: "p1" } });
    await expect(request(path, "fail", {})).rejects.toThrow("pane disappeared");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});
