import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import {
  type Http2ServerRequest,
  type Http2ServerResponse,
  type ServerHttp2Session,
  createSecureServer,
} from "node:http2";
import {
  type Server as NetServer,
  type Socket,
  createServer as createNetServer,
} from "node:net";

export interface LoopbackTls {
  key: string;
  cert: string;
}

export interface LoopbackServer {
  server: NetServer;
  secure: boolean;
  close(): Promise<void>;
}

type Listener = (
  request: IncomingMessage | Http2ServerRequest,
  response: ServerResponse | Http2ServerResponse,
) => Promise<void>;

const FIRST_BYTE_TIMEOUT_MS = 10_000;

const CLOSE_GRACE_MS = 1_000;

/**
 * Plain HTTP, or with `tls` one port for both: a TLS ClientHello starts with
 * 0x16, a plain HTTP request never does.
 */
export function createLoopbackServer(
  listener: Listener,
  tls?: LoopbackTls,
  log?: (message: string) => void,
): LoopbackServer {
  const plain = createServer(listener);

  const plainOnly = {
    server: plain,
    secure: false,
    close: () => closeServer(plain),
  };

  if (!tls) return plainOnly;

  let secure: ReturnType<typeof createSecureServer>;

  try {
    secure = createSecureServer(
      // In MB. At Node's 10 MB default, queued large responses reset streams.
      { ...tls, allowHTTP1: true, maxSessionMemory: 1_024 },
      listener,
    );
  } catch (error) {
    log?.(`TLS unavailable, serving plain HTTP only: ${String(error)}`);

    return plainOnly;
  }

  // Sniffed sockets bypass plain.listen(), which starts its idle and timeout tracking.
  plain.emit("listening");

  const sockets = new Set<Socket>();
  const pending = new Set<Socket>();
  const sessions = new Set<ServerHttp2Session>();

  secure.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  secure.on("tlsClientError", (_error, socket) => socket.destroy());

  const server = createNetServer((socket) => {
    sockets.add(socket);
    pending.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      pending.delete(socket);
    });
    socket.on("error", () => socket.destroy());

    const silent = () => socket.destroy();

    socket.setTimeout(FIRST_BYTE_TIMEOUT_MS);
    socket.once("timeout", silent);
    socket.once("data", (head: Buffer) => {
      pending.delete(socket);
      socket.setTimeout(0);
      socket.off("timeout", silent);
      socket.pause();
      socket.unshift(head);

      if (head[0] === 0x16) secure.emit("connection", socket);
      else {
        plain.emit("connection", socket);
        socket.resume();
      }
    });
  });

  return {
    server,
    secure: true,
    close: async () => {
      const closed = closeServer(server);

      for (const socket of pending) socket.destroy();
      plain.close();

      for (const session of sessions) session.close();

      const force = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
      }, CLOSE_GRACE_MS);

      try {
        await closed;
      } finally {
        clearTimeout(force);
      }
    },
  };
}

function closeServer(server: NetServer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();

      return;
    }

    server.close((error) => (error ? reject(error) : resolve()));
  });
}
