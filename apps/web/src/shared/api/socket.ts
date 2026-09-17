import {
  CALL_NAMESPACE,
  CallClientEvent,
  CHAT_NAMESPACE,
  ClientEvent,
  VOICE_NAMESPACE,
  VoiceClientEvent,
} from "@voreli/shared";
import { io, type Socket } from "socket.io-client";

import { serverUrl } from "../config/env";
import { getAccessToken, observeAccessToken } from "./http";

let chat: Socket | null = null;
let voice: Socket | null = null;
let call: Socket | null = null;

observeAccessToken((token) => {
  if (token !== null && chat?.connected === true) {
    chat.emit(ClientEvent.RefreshAuth, { accessToken: token });
  }
  if (token !== null && voice?.connected === true) {
    voice.emit(VoiceClientEvent.RefreshAuth, { accessToken: token });
  }
  if (token !== null && call?.connected === true) {
    call.emit(CallClientEvent.RefreshAuth, { accessToken: token });
  }
});

/**
 * One socket per session, created lazily after login.
 *
 * `autoConnect: false` matters: the handshake carries the access token, and connecting
 * before login would hand the server an empty token and be refused.
 */
export function chatSocket(): Socket {
  if (chat === null) {
    chat = createSocket(CHAT_NAMESPACE);
  }

  return chat;
}

export function voiceSocket(): Socket {
  if (voice === null) {
    voice = createSocket(VOICE_NAMESPACE);
  }

  return voice;
}

export function callSocket(): Socket {
  if (call === null) call = createSocket(CALL_NAMESPACE);
  return call;
}

function createSocket(namespace: string): Socket {
  return io(`${serverUrl()}${namespace}`, {
    autoConnect: false,
    transports: ["websocket"],
    auth: (callback: (data: Record<string, unknown>) => void) => {
      callback({ token: getAccessToken() ?? "" });
    },
  });
}

export function disconnectSocket(): void {
  chat?.disconnect();
  voice?.disconnect();
  call?.disconnect();
  chat = null;
  voice = null;
  call = null;
}
