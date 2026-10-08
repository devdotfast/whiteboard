import { connect } from "node:net";
import { randomUUID } from "node:crypto";

/** Herdr 0.7's local API is one JSON request/response per line. */
export function request<T>(socketPath: string, method: string, params: object, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error(`Herdr ${method} timed out`)), timeout);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify({ id, method, params }) + "\n"));
    socket.on("error", error => finish(error));
    socket.on("end", () => finish(new Error("Herdr closed the socket before replying")));
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) { finish(new Error("Herdr response exceeds 4 MiB")); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const reply = JSON.parse(line);
          if (reply.id !== id) continue;
          if (reply.error) finish(new Error(reply.error.message ?? String(reply.error.code)));
          else if ("result" in reply) finish(undefined, reply.result);
          else finish(new Error("Herdr returned a malformed response"));
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      }
    });
  });
}
