import { createServer, createConnection, type Socket } from "node:net";
import { mkdtemp, chmod, rm, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const prefix = "diffr.open:";
export interface OpenRequest { sessionID: string; directory: string; args: string[] }
interface Invitation { socket: string; token: string; sessionID: string; directory: string }

function line(socket: Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = "";
    const clean = () => { socket.off("data", data); socket.off("error", error); socket.off("close", close); };
    const error = (cause: Error) => { clean(); reject(cause); };
    const close = () => error(new Error("Diffr tool connection closed before acknowledgement."));
    const data = (chunk: Buffer) => {
      text += chunk.toString();
      if (text.length > 65536) { error(new Error("Diffr tool response is too large.")); return; }
      if (!text.includes("\n")) return;
      clean();
      try { resolve(JSON.parse(text.slice(0, text.indexOf("\n")))); } catch (cause) { reject(cause); }
    };
    socket.on("data", data); socket.on("error", error); socket.on("close", close);
  });
}
const send = (socket: Socket, value: unknown) => socket.write(JSON.stringify(value) + "\n");

/** Success means a matching TUI opened the pane. */
export async function requestOpen(publish: (command: string) => Promise<unknown>, request: OpenRequest,
  signal: AbortSignal, timeout = 20_000): Promise<string> {
  signal.throwIfAborted();
  const directory = await realpath(request.directory);
  const dir = await mkdtemp("/tmp/diffr-oc-");
  await chmod(dir, 0o700);
  const invitation: Invitation = { socket: `${dir}/open.sock`, token: randomUUID(), sessionID: request.sessionID, directory };
  const sockets = new Set<Socket>();
  const server = createServer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(invitation.socket, resolve); });
    await chmod(invitation.socket, 0o600);
    return await new Promise<string>((resolve, reject) => {
      let claimed = false;
      timer = setTimeout(() => reject(new Error("No matching Diffr terminal acknowledged the open. Keep the session visible in a local TUI with the Diffr plugin enabled.")), timeout);
      abort = () => reject(new Error("Diffr open cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      server.on("connection", socket => {
        let accepted = false;
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        void (async () => {
          const hello = await line(socket) as { token?: string };
          if (hello?.token !== invitation.token || claimed) { socket.destroy(); return; }
          accepted = claimed = true; // One terminal owns this request, even if several display the session.
          const response = line(socket);
          send(socket, { ...request, directory });
          const value = await response as { result?: string; error?: string };
          if (typeof value?.result === "string") resolve(value.result);
          else reject(new Error(value?.error ?? "Invalid Diffr terminal acknowledgement."));
        })().catch(error => { if (accepted) reject(error); else socket.destroy(); });
      });
      void publish(prefix + JSON.stringify(invitation)).catch(reject);
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

/** Ignores other sessions and directories; never steals focus. */
export async function receiveOpen(command: string, directory: string, session: () => string | undefined,
  open: (request: OpenRequest, signal: AbortSignal) => Promise<string>, lifetime: AbortSignal): Promise<void> {
  if (typeof command !== "string" || !command.startsWith(prefix) || lifetime.aborted) return;
  const invitation: Invitation = JSON.parse(command.slice(prefix.length));
  if (!invitation || typeof invitation.socket !== "string" || !/^\/tmp\/diffr-oc-[A-Za-z0-9]+\/open\.sock$/.test(invitation.socket)
    || typeof invitation.token !== "string" || invitation.sessionID !== session()
    || invitation.directory !== await realpath(directory)) return;
  const socket = createConnection(invitation.socket);
  const controller = new AbortController();
  const abort = () => { controller.abort(); socket.destroy(); };
  lifetime.addEventListener("abort", abort, { once: true });
  socket.on("close", () => controller.abort());
  socket.on("error", () => controller.abort());
  try {
    const incoming = line(socket);
    send(socket, { token: invitation.token });
    const request = await incoming as OpenRequest;
    if (lifetime.aborted || session() !== invitation.sessionID || request.sessionID !== invitation.sessionID
      || request.directory !== invitation.directory || !Array.isArray(request.args) || request.args.some(arg => typeof arg !== "string"))
      throw new Error("Diffr session changed before the pane could open.");
    const result = await open(request, controller.signal);
    send(socket, { result });
  } catch (cause) {
    if (!socket.destroyed) send(socket, { error: cause instanceof Error ? cause.message : String(cause) });
  } finally {
    lifetime.removeEventListener("abort", abort);
    socket.end();
  }
}
