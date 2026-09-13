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

import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { callSocket } from "../../shared/api/socket";
import { voiceSession } from "../voice-join/voice-session";

export class DirectCallSession {
  private socket: Socket | null = null;
  private joiningMediaRoomId: string | null = null;
  private preparedMicrophone: Promise<MediaStream> | null = null;
  private stopQuality: (() => void) | undefined;

  private readonly onConnected = () => {
    void this.sync().catch((error: unknown) => this.fail(error));
  };
  private readonly onIncoming = ({ call }: CallEvent) => {
    useDirectCall.getState().replace({ call, mediaRoomId: null, error: null });
  };
  private readonly onRinging = ({ call }: CallEvent) => {
    useDirectCall.getState().replace({ call, mediaRoomId: null, error: null });
  };
  private readonly onAnswered = (event: CallAnsweredEvent) => {
    if (event.mediaRoomId !== null) {
      void this.activate(event.call, event.mediaRoomId);
    } else {
      useDirectCall.getState().reset();
    }
  };
  private readonly onEnded = ({ call }: CallEvent) => {
    if (useDirectCall.getState().call?.id !== call.id) return;
    this.stopQualityObserver();
    void voiceSession
      .leave()
      .catch((error: unknown) => {
        console.error("Failed to announce voice leave after a direct call ended", error);
      })
      .finally(() => useDirectCall.getState().complete(call.conversationId));
  };
  private readonly onConnectionQuality = (event: CallConnectionQualityEvent) => {
    if (useDirectCall.getState().call?.id === event.callId) {
      useDirectCall.getState().replace({ quality: event.quality });
    }
  };
  private readonly onParticipantReconnecting = (event: CallParticipantReconnectingEvent) => {
    if (useDirectCall.getState().call?.id === event.callId) {
      useDirectCall.getState().replace({
        reconnectingUserId: event.reconnecting ? event.userId : null,
      });
    }
  };

  constructor(private readonly socketFactory: () => Socket = callSocket) {}

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
    useDirectCall.getState().reset();
  }

  async start(conversationId: string): Promise<void> {
    voiceSession.unlockAudio();
    useDirectCall.getState().replace({ error: null });
    try {
      const response = await this.request<StartCallResponse>(CallClientEvent.Start, {
        conversationId,
        clientNonce: crypto.randomUUID(),
      });
      useDirectCall.getState().replace({ call: response.call, error: null });
    } catch (error: unknown) {
      this.fail(error);
      throw error;
    }
  }

  async accept(): Promise<void> {
    const call = useDirectCall.getState().call;
    if (!call) return;
    const microphone = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    void microphone.catch(() => undefined);
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
    useDirectCall.getState().replace({ call, mediaRoomId, error: null });
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
      useDirectCall.getState().replace({
        error: error instanceof Error ? error.message : "Call media connection failed",
      });
    } finally {
      this.joiningMediaRoomId = null;
    }
  }

  private async sync(): Promise<void> {
    const response = await this.request<SyncCallResponse>(CallClientEvent.Sync, {});
    if (!response.call) {
      const current = useDirectCall.getState().call;
      if (current) {
        await voiceSession.leave();
        useDirectCall.getState().complete(current.conversationId);
      } else {
        useDirectCall.getState().reset();
      }
      return;
    }
    if (response.mediaRoomId) {
      await this.activate(response.call, response.mediaRoomId);
    } else {
      useDirectCall.getState().replace({
        call: response.call,
        mediaRoomId: null,
        error: null,
      });
    }
  }

  private async terminal(event: string): Promise<void> {
    const call = useDirectCall.getState().call;
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
    const stream = await microphone.catch(() => null);
    stream?.getTracks().forEach((track) => track.stop());
  }

  private stopQualityObserver(): void {
    this.stopQuality?.();
    this.stopQuality = undefined;
  }

  private fail(error: unknown): void {
    useDirectCall.getState().replace({
      error: error instanceof Error ? error.message : "Call signaling failed",
    });
  }
}

export const directCallSession = new DirectCallSession();
