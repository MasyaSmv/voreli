import {
  type Ack,
  type CreateConsumerResponse,
  type CreateProducerResponse,
  type CreateTransportResponse,
  VoiceClientEvent,
  type VoiceJoinResponse,
  type VoiceErrorEvent,
  type VoiceParticipantJoinedEvent,
  type VoiceParticipantUpdatedEvent,
  type VoiceProducerClosedEvent,
  type VoiceProducerEvent,
  VoiceServerEvent,
  type VoiceSpeakingEvent,
} from "@voreli/shared";
import type { types } from "mediasoup-client";
import type { Socket } from "socket.io-client";

import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { voiceSocket } from "../../shared/api/socket";

class VoiceRequestError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "VoiceRequestError";
  }
}

interface ReceivedAudio {
  readonly consumer: types.Consumer;
  readonly element: HTMLAudioElement;
}

class VoiceSession {
  private readonly socket: Socket;
  private device: types.Device | undefined;
  private sendTransport: types.Transport | undefined;
  private recvTransport: types.Transport | undefined;
  private producer: types.Producer | undefined;
  private readonly received = new Map<string, ReceivedAudio>();
  private remoteSpeakingUserIds: ReadonlySet<string> = new Set();
  private localSpeaking = false;
  private audioContext: AudioContext | undefined;
  private microphoneSource: MediaStreamAudioSourceNode | undefined;
  private speakingFrame: number | undefined;
  private channelId: string | null = null;
  private sessionId: string | null = null;
  private transition: Promise<void> = Promise.resolve();

  constructor() {
    this.socket = voiceSocket();
    this.socket.on("disconnect", () => {
      if (this.channelId !== null) useVoice.getState().replace({ connection: "reconnecting" });
    });
    this.socket.on("connect", () => {
      if (this.channelId !== null && this.sessionId !== null) {
        void this.serial(() => this.resume()).catch((error: unknown) => this.fail(error));
      }
    });
    this.socket.on(VoiceServerEvent.ParticipantJoined, (event: VoiceParticipantJoinedEvent) => {
      useVoice.getState().upsertParticipant(event.participant);
    });
    this.socket.on(VoiceServerEvent.ParticipantUpdated, (event: VoiceParticipantUpdatedEvent) => {
      useVoice.getState().upsertParticipant(event.participant);
    });
    this.socket.on(VoiceServerEvent.ParticipantLeft, (event: { userId: string }) => {
      useVoice
        .getState()
        .participants.find((participant) => participant.userId === event.userId)
        ?.producers.forEach((producer) => this.closeReceived(producer.producerId));
      useVoice.getState().removeParticipant(event.userId);
    });
    this.socket.on(VoiceServerEvent.ProducerNew, (event: VoiceProducerEvent) => {
      const participant = useVoice
        .getState()
        .participants.find((current) => current.userId === event.userId);
      if (
        participant &&
        !participant.producers.some(({ producerId }) => producerId === event.producerId)
      ) {
        useVoice.getState().upsertParticipant({
          ...participant,
          producers: [...participant.producers, { producerId: event.producerId, kind: event.kind }],
        });
      }
      if (event.userId !== useSession.getState().user?.id) {
        void this.consume(event.producerId).catch((error: unknown) => this.fail(error));
      }
    });
    this.socket.on(VoiceServerEvent.ProducerClosed, (event: VoiceProducerClosedEvent) => {
      if (this.producer?.id === event.producerId) {
        this.producer.close();
        this.producer = undefined;
      }
      this.closeReceived(event.producerId);
      for (const participant of useVoice.getState().participants) {
        if (participant.producers.some(({ producerId }) => producerId === event.producerId)) {
          useVoice.getState().upsertParticipant({
            ...participant,
            producers: participant.producers.filter(
              ({ producerId }) => producerId !== event.producerId,
            ),
          });
        }
      }
    });
    this.socket.on(VoiceServerEvent.Speaking, (event: VoiceSpeakingEvent) => {
      this.remoteSpeakingUserIds = new Set(event.speaking.map((speaker) => speaker.userId));
      this.publishSpeaking();
    });
    this.socket.on(VoiceServerEvent.Error, (event: VoiceErrorEvent) => {
      this.fail(new VoiceRequestError(event.errorCode, event.message));
      if (event.errorCode === "VOICE_CONNECT_FORBIDDEN") {
        this.closeLocalMedia();
        this.closeAudio();
        this.channelId = null;
        this.sessionId = null;
        useVoice.getState().replace({
          channelId: null,
          sessionId: null,
          connection: "idle",
          participants: [],
          speakingUserIds: new Set(),
        });
      }
    });
  }

  join(channelId: string): Promise<void> {
    this.unlockAudio();
    const microphone = navigator.mediaDevices.getUserMedia({ audio: true });
    void microphone.catch((error: unknown) => this.fail(error));
    return this.serial(() => this.joinFresh(channelId, microphone)).catch((error: unknown) => {
      this.fail(error);
      throw error;
    });
  }

  leave(): Promise<void> {
    return this.serial(async () => {
      if (this.channelId !== null && this.socket.connected) {
        await this.request<null>(VoiceClientEvent.Leave, {});
      }
      this.closeLocalMedia();
      this.closeAudio();
      this.channelId = null;
      this.sessionId = null;
      useVoice.getState().replace({
        channelId: null,
        sessionId: null,
        connection: "idle",
        participants: [],
        speakingUserIds: new Set(),
        error: null,
      });
    });
  }

  setSelfMuted(selfMuted: boolean): Promise<void> {
    return this.serial(() =>
      this.setSelfState({
        selfMuted,
        selfDeafened: this.selfParticipant()?.selfDeafened ?? false,
      }),
    ).catch((error: unknown) => {
      this.fail(error);
      throw error;
    });
  }

  setSelfDeafened(selfDeafened: boolean): Promise<void> {
    return this.serial(() =>
      this.setSelfState({
        selfMuted: this.selfParticipant()?.selfMuted ?? false,
        selfDeafened,
      }),
    ).catch((error: unknown) => {
      this.fail(error);
      throw error;
    });
  }

  resumeAudio(): Promise<void> {
    this.unlockAudio();
    return this.serial(async () => {
      for (const received of this.received.values()) {
        await received.element.play();
        await this.request<null>(VoiceClientEvent.ResumeConsumer, {
          consumerId: received.consumer.id,
        });
      }
      useVoice.getState().replace({ error: null });
    }).catch((error: unknown) => {
      this.fail(error);
      throw error;
    });
  }

  startEcho(): Promise<void> {
    this.unlockAudio();
    return this.serial(async () => {
      if (!this.producer) throw new Error("Микрофон ещё не готов");
      await this.consume(this.producer.id);
    }).catch((error: unknown) => {
      this.fail(error);
      throw error;
    });
  }

  private async joinFresh(channelId: string, microphone: Promise<MediaStream>): Promise<void> {
    if (this.channelId === channelId && useVoice.getState().connection === "connected") {
      (await microphone).getTracks().forEach((track) => track.stop());
      return;
    }

    let stream: MediaStream | undefined;
    let joinedServer = false;

    try {
      useVoice.getState().replace({ connection: "joining", error: null });
      if (!this.socket.connected) {
        this.socket.connect();
        await new Promise<void>((resolve, reject) => {
          this.socket.once("connect", resolve);
          this.socket.once("connect_error", reject);
        });
      }

      if (this.channelId !== null) {
        await this.request<null>(VoiceClientEvent.Leave, {});
        this.closeLocalMedia();
      }

      const joined = await this.request<VoiceJoinResponse>(VoiceClientEvent.Join, { channelId });
      joinedServer = true;
      this.channelId = channelId;
      this.sessionId = joined.sessionId;
      useVoice.getState().replace({
        channelId,
        sessionId: joined.sessionId,
        participants: joined.participants,
      });

      stream = await microphone;
      await this.buildMedia(joined, stream);
      useVoice.getState().replace({ connection: "connected" });
    } catch (error: unknown) {
      if (stream === undefined) {
        stream = await microphone.then(
          (captured) => captured,
          (microphoneError: unknown) => {
            this.fail(microphoneError);
            return undefined;
          },
        );
      }
      stream?.getTracks().forEach((track) => track.stop());
      if (joinedServer && this.socket.connected) {
        try {
          await this.request<null>(VoiceClientEvent.Leave, {});
        } catch (cleanupError: unknown) {
          this.fail(cleanupError);
        }
      }
      this.closeLocalMedia();
      this.closeAudio();
      this.channelId = null;
      this.sessionId = null;
      useVoice.getState().replace({
        channelId: null,
        sessionId: null,
        connection: "idle",
        participants: [],
        speakingUserIds: new Set(),
      });
      throw error;
    }
  }

  private async resume(): Promise<void> {
    if (this.channelId === null || this.sessionId === null) return;
    const joined = await this.request<VoiceJoinResponse>(VoiceClientEvent.Join, {
      channelId: this.channelId,
      sessionId: this.sessionId,
    });
    this.sessionId = joined.sessionId;
    useVoice.getState().replace({
      sessionId: joined.sessionId,
      participants: joined.participants,
      connection: "connected",
    });

    if (!joined.resumed) {
      this.closeLocalMedia();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.buildMedia(joined, stream);
    }
  }

  private async buildMedia(joined: VoiceJoinResponse, stream: MediaStream): Promise<void> {
    const { Device } = await import("mediasoup-client");
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: joined.rtpCapabilities });
    const [sendOptions, recvOptions] = await Promise.all([
      this.request<CreateTransportResponse>(VoiceClientEvent.CreateTransport, {
        direction: "send",
      }),
      this.request<CreateTransportResponse>(VoiceClientEvent.CreateTransport, {
        direction: "recv",
      }),
    ]);
    this.sendTransport = this.device.createSendTransport({
      ...sendOptions,
      iceCandidates: [...sendOptions.iceCandidates],
    });
    this.recvTransport = this.device.createRecvTransport({
      ...recvOptions,
      iceCandidates: [...recvOptions.iceCandidates],
    });
    this.bindTransport(this.sendTransport);
    this.bindTransport(this.recvTransport);
    this.sendTransport.on("produce", ({ kind, rtpParameters }, accept, reject) => {
      void this.request<CreateProducerResponse>(VoiceClientEvent.CreateProducer, {
        transportId: this.sendTransport?.id ?? "",
        kind,
        rtpParameters,
      }).then(({ producerId }) => accept({ id: producerId }), reject);
    });

    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Микрофон не вернул аудиодорожку");
    try {
      this.producer = await this.sendTransport.produce({
        track,
        codecOptions: { opusDtx: true, opusFec: true, opusMaxAverageBitrate: 40_000 },
        zeroRtpOnPause: true,
      });
      this.observeMicrophone(track);
    } catch (error: unknown) {
      track.stop();
      if (!(error instanceof VoiceRequestError && error.errorCode === "VOICE_SPEAK_FORBIDDEN")) {
        throw error;
      }
    }

    const ownUserId = useSession.getState().user?.id;
    await Promise.all(
      joined.participants.flatMap((participant) =>
        participant.userId === ownUserId
          ? []
          : participant.producers.map((producer) => this.consume(producer.producerId)),
      ),
    );
  }

  private bindTransport(transport: types.Transport): void {
    transport.on("connect", ({ dtlsParameters }, accept, reject) => {
      void this.request<null>(VoiceClientEvent.ConnectTransport, {
        transportId: transport.id,
        dtlsParameters,
      }).then(() => accept(), reject);
    });
    transport.on("connectionstatechange", (state) => {
      if (state === "disconnected" || state === "failed") {
        void this.restartIce(transport).catch((error: unknown) => this.fail(error));
      }
    });
  }

  private async restartIce(transport: types.Transport): Promise<void> {
    const response = await this.request<{
      iceParameters: CreateTransportResponse["iceParameters"];
    }>(VoiceClientEvent.RestartIce, { transportId: transport.id });
    await transport.restartIce(response);
  }

  private async consume(producerId: string): Promise<void> {
    if (!this.device || !this.recvTransport || this.received.has(producerId)) return;
    const response = await this.request<CreateConsumerResponse>(VoiceClientEvent.CreateConsumer, {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume({
      id: response.consumerId,
      producerId: response.producerId,
      kind: response.kind,
      rtpParameters: response.rtpParameters,
    });
    const element = new Audio();
    element.hidden = true;
    element.dataset["producerId"] = producerId;
    element.srcObject = new MediaStream([consumer.track]);
    document.body.append(element);
    this.received.set(producerId, { consumer, element });
    if (!(this.selfParticipant()?.selfDeafened ?? false)) await element.play();
    await this.request<null>(VoiceClientEvent.ResumeConsumer, { consumerId: consumer.id });
  }

  private async setSelfState(state: { selfMuted: boolean; selfDeafened: boolean }): Promise<void> {
    await this.request<null>(VoiceClientEvent.SetSelfState, state);
    if (state.selfMuted) {
      this.producer?.pause();
      this.localSpeaking = false;
      this.publishSpeaking();
    } else {
      this.producer?.resume();
    }
    for (const received of this.received.values()) {
      if (state.selfDeafened) received.element.pause();
      else await received.element.play();
    }
  }

  private selfParticipant() {
    const userId = useSession.getState().user?.id;
    return useVoice.getState().participants.find((participant) => participant.userId === userId);
  }

  private async request<T>(event: string, payload: unknown): Promise<T> {
    const response = (await this.socket.timeout(7_000).emitWithAck(event, payload)) as Ack<T>;
    if (!response.ok) throw new VoiceRequestError(response.errorCode, response.message);
    return response.data;
  }

  private closeReceived(producerId: string): void {
    const received = this.received.get(producerId);
    if (!received) return;
    received.consumer.close();
    received.element.pause();
    received.element.srcObject = null;
    received.element.remove();
    this.received.delete(producerId);
  }

  private closeLocalMedia(): void {
    this.producer?.close();
    this.sendTransport?.close();
    this.recvTransport?.close();
    for (const producerId of [...this.received.keys()]) this.closeReceived(producerId);
    this.producer = undefined;
    this.sendTransport = undefined;
    this.recvTransport = undefined;
    this.device = undefined;
    this.remoteSpeakingUserIds = new Set();
    this.localSpeaking = false;
    if (this.speakingFrame !== undefined) cancelAnimationFrame(this.speakingFrame);
    this.speakingFrame = undefined;
    this.microphoneSource?.disconnect();
    this.microphoneSource = undefined;
  }

  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.transition.then(work, work);
    this.transition = next.catch(() => undefined);
    return next;
  }

  private unlockAudio(): void {
    this.audioContext ??= new window.AudioContext();
    void this.audioContext.resume().catch((error: unknown) => this.fail(error));
  }

  private closeAudio(): void {
    if (!this.audioContext) return;
    void this.audioContext.close().catch((error: unknown) => this.fail(error));
    this.audioContext = undefined;
  }

  private observeMicrophone(track: MediaStreamTrack): void {
    if (!this.audioContext) return;
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.microphoneSource = this.audioContext.createMediaStreamSource(new MediaStream([track]));
    this.microphoneSource.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const measure = (): void => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
      );
      const speaking = !this.producer?.paused && rms > 0.025;
      if (speaking !== this.localSpeaking) {
        this.localSpeaking = speaking;
        this.publishSpeaking();
      }
      this.speakingFrame = requestAnimationFrame(measure);
    };
    measure();
  }

  private publishSpeaking(): void {
    const speaking = new Set(this.remoteSpeakingUserIds);
    const ownUserId = useSession.getState().user?.id;
    if (ownUserId) {
      if (this.localSpeaking) speaking.add(ownUserId);
      else speaking.delete(ownUserId);
    }
    useVoice.getState().replace({ speakingUserIds: speaking });
  }

  private fail(error: unknown): void {
    useVoice.getState().replace({
      error: error instanceof Error ? error.message : "Ошибка голосового соединения",
    });
  }
}

export const voiceSession = new VoiceSession();
