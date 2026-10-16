import type { Ack } from "@voreli/shared";
import type { Socket } from "socket.io-client";

import { voiceSocket } from "../../shared/api/socket";
import { VoiceRequestError } from "./voice-request-error";

/**
 * The signaling channel of a voice session, narrowed to what the client actually asks of it.
 *
 * It is a contract rather than a bare socket because a second implementation is a given: a
 * test drives the whole client against an in-memory double instead of a live server, and the
 * pieces below then need no knowledge of Socket.IO at all.
 */
export interface VoiceSignaling {
  readonly connected: boolean;
  connect(): Promise<void>;
  request<T>(event: string, payload: unknown): Promise<T>;
  on<E>(event: string, listener: (payload: E) => void): void;
}

/** How long a signaling round trip may take before the session treats it as lost. */
const REQUEST_TIMEOUT_MS = 7_000;

export class SocketVoiceSignaling implements VoiceSignaling {
  constructor(private readonly socket: Socket = voiceSocket()) {}

  get connected(): boolean {
    return this.socket.connected;
  }

  async connect(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", reject);
      this.socket.connect();
    });
  }

  // Every voice request is a question with an answer, so failures arrive as a negative ack
  // rather than as a thrown error; turning them back into one keeps call sites linear.
  async request<T>(event: string, payload: unknown): Promise<T> {
    const response = (await this.socket
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck(event, payload)) as Ack<T>;
    if (!response.ok) throw new VoiceRequestError(response.errorCode, response.message);
    return response.data;
  }

  on<E>(event: string, listener: (payload: E) => void): void {
    this.socket.on(event, listener);
  }
}
