import { CHAT_NAMESPACE } from "@voreli/shared";
import { io, type Socket } from "socket.io-client";

import { serverUrl } from "../config/env";
import { getAccessToken } from "./http";

let socket: Socket | null = null;

/**
 * One socket per session, created lazily after login.
 *
 * `autoConnect: false` matters: the handshake carries the access token, and connecting
 * before login would hand the server an empty token and be refused.
 */
export function chatSocket(): Socket {
  if (socket === null) {
    socket = io(`${serverUrl()}${CHAT_NAMESPACE}`, {
      autoConnect: false,
      transports: ["websocket"],
      auth: (callback: (data: Record<string, unknown>) => void) => {
        callback({ token: getAccessToken() ?? "" });
      },
    });
  }

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
