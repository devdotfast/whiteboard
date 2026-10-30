import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";

import { connectReviewApi } from "@review/review-api/agent-client.js";
import { z } from "zod";

const resultSchema = z.strictObject({
  shareId: z.uuid(),
  version: z.number().int(),
  url: z.url(),
});

export async function runShareCli(input: {
  review?: string;
  version?: string;
  requestId?: string;
  preview?: boolean;
  revoke?: string;
  json?: boolean;
  env?: NodeJS.ProcessEnv;
  stdout: Writable;
  stderr: Writable;
}) {
  try {
    const client = await connectReviewApi(input.env);

    if (input.revoke) {
      const result = z
        .strictObject({ shareId: z.uuid(), revoked: z.literal(true) })
        .parse(await client.post("/sharing/revoke", { shareId: input.revoke }));

      input.stdout.write(
        input.json
          ? JSON.stringify(result) + "\n"
          : "Share revoked. Existing downloads remain available offline.\n",
      );
    } else {
      if (!input.review) throw new Error("Use whiteboard share --review <id>.");

      const version =
        input.version === undefined
          ? undefined
          : z.number().int().nonnegative().parse(Number(input.version));

      input.stderr.write(
        "Sharing uploads the whiteboard with its maps, full trace conversations, and the code lines it references. Anyone with the link can read them; no GitHub access is needed. Opening it in Whiteboard Desktop also fetches the pinned commits from GitHub.\n",
      );

      const result = resultSchema.parse(
        await client.post("/sharing/publish", {
          reviewId: input.review,
          version,
          requestId:
            input.requestId === undefined
              ? randomUUID()
              : z.uuid().parse(input.requestId),
        }),
      );

      if (input.preview) {
        const url = new URL(result.url);
        url.searchParams.set("app", "preview");
        result.url = url.href;
      }

      input.stdout.write(
        input.json ? JSON.stringify(result) + "\n" : result.url + "\n",
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sharing failed.";

    if (input.json)
      input.stdout.write(
        JSON.stringify({ error: { code: "share_failed", message } }) + "\n",
      );
    input.stderr.write(message + "\n");

    return 1;
  }
}

const exportSchema = z.strictObject({
  filename: z.string().min(1),
  text: z.string(),
});

export async function runExportCli(input: {
  review?: string;
  version?: string;
  out?: string;
  json?: boolean;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdout: Writable;
  stderr: Writable;
}) {
  try {
    if (!input.review) throw new Error("Use whiteboard export --review <id>.");

    const client = await connectReviewApi(input.env);

    const result = exportSchema.parse(
      await client.post("/sharing/export", {
        reviewId: input.review,
        version:
          input.version === undefined
            ? undefined
            : z.number().int().nonnegative().parse(Number(input.version)),
      }),
    );

    if (input.out === "-") {
      input.stdout.write(result.text);

      return 0;
    }

    const file = path.resolve(input.cwd, input.out ?? result.filename);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, result.text);
    input.stdout.write(
      input.json ? JSON.stringify({ path: file }) + "\n" : file + "\n",
    );

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";

    if (input.json)
      input.stdout.write(
        JSON.stringify({ error: { code: "export_failed", message } }) + "\n",
      );
    input.stderr.write(message + "\n");

    return 1;
  }
}
