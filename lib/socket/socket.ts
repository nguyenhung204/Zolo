import { io, Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents, CallClientEvents, CallServerEvents } from "./events";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3002";

// ─── Chat socket ─────────────────────────────────────────────────────────────

let chatSocket: Socket<ServerEvents, ClientEvents> | null = null;

export function getChatSocket(): Socket<ServerEvents, ClientEvents> {
  if (!chatSocket) {
    chatSocket = io(`${WS_URL}/chat`, {
      autoConnect: false,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      transports: ["websocket"],
    });
  }
  return chatSocket;
}

export function connectChatSocket(token: string) {
  const socket = getChatSocket();
  if (socket.connected || socket.active) {
    socket.disconnect();
  }
  // Pass raw JWT (no Bearer prefix) — server's JWKS guard reads handshake.auth.token
  socket.auth = { token };
  socket.connect();
  return socket;
}

export function disconnectChatSocket() {
  chatSocket?.disconnect();
}

// ─── Call socket ─────────────────────────────────────────────────────────────

let callSocket: Socket<CallServerEvents, CallClientEvents> | null = null;

export function getCallSocket(): Socket<CallServerEvents, CallClientEvents> {
  if (!callSocket) {
    callSocket = io(`${WS_URL}/call`, {
      autoConnect: false,
      reconnectionAttempts: Infinity,
      transports: ["websocket"],
    });
  }
  return callSocket;
}

export function connectCallSocket(token: string) {
  const socket = getCallSocket();
  if (socket.connected || socket.active) {
    socket.disconnect();
  }
  socket.auth = { token };
  socket.connect();
  return socket;
}

export function disconnectCallSocket() {
  callSocket?.disconnect();
}
