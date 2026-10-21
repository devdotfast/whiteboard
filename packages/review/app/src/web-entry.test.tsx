import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { share } from "./shared-board-test-utils";
import { Whiteboard } from "./web-entry";

// A page that renders on a server, as review-web does in Workers, imports and
// renders the component there; the board itself mounts in the browser.
it("renders on a server without a DOM", async () => {
  expect("window" in globalThis).toBe(false);

  const html = renderToString(
    <Whiteboard
      share={await share("three-minute-tour")}
      wasmUrl="/libavoid.wasm"
    />,
  );

  expect(html).toContain('class="review-canvas-root"');
});

it("shows a share nested past the stack as unreadable", async () => {
  const sealed = await share("bug-report-dialog");
  const depth = 50_000;

  // Built as text: serializing this depth would overflow the stack too.
  const bytes = new TextEncoder().encode(
    `{"reviewId":"${sealed.manifest.reviewId}","version":${sealed.manifest.version},"title":"${sealed.manifest.title}","createdAt":"2026-10-20T00:00:00.000Z","document":[${'{"type":"section","title":"x","children":['.repeat(depth)}${"]}".repeat(depth)}]}`,
  );

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  const snapshot = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const html = renderToString(
    <Whiteboard
      share={{
        manifest: {
          ...sealed.manifest,
          snapshot,
          objects: [
            ...sealed.manifest.objects.filter(
              (item) => item.id !== sealed.manifest.snapshot,
            ),
            { id: snapshot, sha256: snapshot, size: bytes.byteLength },
          ],
        },
        objects: new Map([...sealed.objects, [snapshot, bytes]]),
      }}
      wasmUrl="/libavoid.wasm"
    />,
  );

  expect(html).toContain("This board can&#x27;t be shown");
});
