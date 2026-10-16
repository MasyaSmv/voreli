import {
  type Ack,
  type AcceptCallResponse,
  CallClientEvent,
  type CallAnsweredEvent,
  type CallConnectionQualityEvent,
  type CallParticipantReconnectingEvent,
  type CallEvent,
  CallServerEvent,
  type DirectCallView,
  type StartCallResponse,
  type SyncCallResponse,
} from "@voreli/shared";
import type { Socket } from "socket.io-client";

import { callSocket } from "../../shared/api/socket";
import { voiceSession } from "../voice-join/voice-session";
import { DirectCallState } from "../../entities/direct-call/direct-call-state";

export class DirectCallSession {
  private socket: Socket | null = null;
  private joiningMediaRoomId: string | null = null;
  private preparedMicrophone: Promise<MediaStream> | null = null;
  private stopQuality: (() => void) | undefined;

  private readonly onConnected = () => {
    void this.sync().catch((error: unknown) => this.fail(error));
  };
  private readonly onIncoming = ({ call }: CallEvent) => {
    this.state.pending(call);
  };
  private readonly onRinging = ({ call }: CallEvent) => {
    this.state.pending(call);
  };
  private readonly onAnswered = (event: CallAnsweredEvent) => {
    if (event.mediaRoomId !== null) {
      void this.activate(event.call, event.mediaRoomId);
    } else {
      this.state.reset();
    }
  };
  private readonly onEnded = ({ call }: CallEvent) => {
    if (this.state.call?.id !== call.id) return;
    this.stopQualityObserver();
    void voiceSession
      .leave()
      .catch((error: unknown) => {
        console.error("Failed to announce voice leave after a direct call ended", error);
      })
      .finally(() => this.state.completed(call.conversationId));
  };
  private readonly onConnectionQuality = (event: CallConnectionQualityEvent) => {
    if (this.state.call?.id === event.callId) this.state.qualityChanged(event.quality);
  };
  private readonly onParticipantReconnecting = (event: CallParticipantReconnectingEvent) => {
    if (this.state.call?.id === event.callId) {
      this.state.peerReconnecting(event.reconnecting ? event.userId : null);
    }
  };

  constructor(
    private readonly socketFactory: () => Socket = callSocket,
    private readonly state: DirectCallState = new DirectCallState(),
  ) {}

  connect(): void {
    if (this.socket === null) {
      this.socket = this.socketFactory();
      this.bind(this.socket);
    }
    if (this.socket.connected) this.onConnected();
    this.socket.connect();
  }

  reset(): void {
    if (this.socket) {
      this.unbind(this.socket);
      this.socket.disconnect();
    }
    this.socket = null;
    this.joiningMediaRoomId = null;
    this.releasePreparedMicrophone();
    this.stopQualityObserver();
    this.state.reset();
  }

  async start(conversationId: string): Promise<void> {
    voiceSession.unlockAudio();
    this.state.clearError();
    try {
      const response = await this.request<StartCallResponse>(CallClientEvent.Start, {
        conversationId,
        clientNonce: crypto.randomUUID(),
      });
      this.state.placed(response.call);
    } catch (error: unknown) {
      this.fail(error);
      throw error;
    }
  }

  async accept(): Promise<void> {
    const call = this.state.call;
    if (!call) return;
    const microphone = voiceSession.captureMicrophone();
    void microphone.catch((error: unknown) => {
      console.warn("Direct-call microphone capture was refused", { error, callId: call.id });
    });
    this.preparedMicrophone = microphone;
    try {
      const response = await this.request<AcceptCallResponse>(CallClientEvent.Accept, {
        callId: call.id,
      });
      await this.activate(response.call, response.mediaRoomId);
    } catch (error: unknown) {
      if (this.preparedMicrophone === microphone) this.preparedMicrophone = null;
      await this.stopMicrophone(microphone);
      throw error;
    }
  }

  async decline(): Promise<void> {
    await this.terminal(CallClientEvent.Decline);
  }

  async cancel(): Promise<void> {
    await this.terminal(CallClientEvent.Cancel);
  }

  async hangup(): Promise<void> {
    await this.terminal(CallClientEvent.Hangup);
  }

  /** A button's action failed after the click; the overlay shows why instead of nothing. */
  actionFailed(error: unknown): void {
    console.warn("Direct-call action failed", { error });
    this.state.failed(error instanceof Error ? error.message : "Call action failed");
  }

  private bind(socket: Socket): void {
    socket.on("connect", this.onConnected);
    socket.on(CallServerEvent.Incoming, this.onIncoming);
    socket.on(CallServerEvent.Ringing, this.onRinging);
    socket.on(CallServerEvent.Answered, this.onAnswered);
    socket.on(CallServerEvent.Ended, this.onEnded);
    socket.on(CallServerEvent.ConnectionQuality, this.onConnectionQuality);
    socket.on(CallServerEvent.ParticipantReconnecting, this.onParticipantReconnecting);
  }

  private unbind(socket: Socket): void {
    socket.off("connect", this.onConnected);
    socket.off(CallServerEvent.Incoming, this.onIncoming);
    socket.off(CallServerEvent.Ringing, this.onRinging);
    socket.off(CallServerEvent.Answered, this.onAnswered);
    socket.off(CallServerEvent.Ended, this.onEnded);
    socket.off(CallServerEvent.ConnectionQuality, this.onConnectionQuality);
    socket.off(CallServerEvent.ParticipantReconnecting, this.onParticipantReconnecting);
  }

  private async activate(call: DirectCallView, mediaRoomId: string): Promise<void> {
    this.state.activated(call, mediaRoomId);
    if (this.joiningMediaRoomId === mediaRoomId) return;
    this.joiningMediaRoomId = mediaRoomId;
    const microphone = this.preparedMicrophone;
    this.preparedMicrophone = null;
    try {
      await voiceSession.joinMediaRoom(mediaRoomId, microphone ?? undefined);
      this.stopQualityObserver();
      this.stopQuality = voiceSession.observeNetworkQuality((quality) => {
        this.socket?.emit(CallClientEvent.ReportQuality, { callId: call.id, quality });
      });
    } catch (error: unknown) {
      console.error("Failed to activate direct-call media", {
        error,
        callId: call.id,
        mediaRoomId,
      });
      this.state.failed(error instanceof Error ? error.message : "Call media connection failed");
    } finally {
      this.joiningMediaRoomId = null;
    }
  }

  private async sync(): Promise<void> {
    const response = await this.request<SyncCallResponse>(CallClientEvent.Sync, {});
    if (!response.call) {
      const current = this.state.call;
      if (current) {
        await voiceSession.leave();
        this.state.completed(current.conversationId);
      } else {
        this.state.reset();
      }
      return;
    }
    if (response.mediaRoomId) {
      await this.activate(response.call, response.mediaRoomId);
    } else {
      this.state.pending(response.call);
    }
  }

  private async terminal(event: string): Promise<void> {
    const call = this.state.call;
    if (!call) return;
    await this.request<StartCallResponse>(event, { callId: call.id });
  }

  private async request<T>(event: string, payload: unknown): Promise<T> {
    const response = (await this.socketOrThrow().emitWithAck(event, payload)) as Ack<T>;
    if (!response.ok) throw new Error(response.message);
    return response.data;
  }

  private socketOrThrow(): Socket {
    if (!this.socket) throw new Error("Call signaling is not connected");
    return this.socket;
  }

  private releasePreparedMicrophone(): void {
    const microphone = this.preparedMicrophone;
    this.preparedMicrophone = null;
    if (microphone) void this.stopMicrophone(microphone);
  }

  private async stopMicrophone(microphone: Promise<MediaStream>): Promise<void> {
    await microphone.catch((error: unknown) => {
      console.warn("Prepared direct-call microphone was unavailable during cleanup", { error });
      return null;
    });
    voiceSession.releaseIdleMicrophone();
  }

  private stopQualityObserver(): void {
    this.stopQuality?.();
    this.stopQuality = undefined;
  }

  private fail(error: unknown): void {
    this.state.failed(error instanceof Error ? error.message : "Call signaling failed");
  }
}

export const directCallSession = new DirectCallSession();
