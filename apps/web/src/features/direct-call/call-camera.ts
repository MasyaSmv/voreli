import { type CallConnectionQuality, VoiceClientEvent } from "@voreli/shared";
import type { types } from "mediasoup-client";

import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { sessionUserId } from "../voice-join/voice-identity";
import type { VoiceSignaling } from "../voice-join/voice-signaling";
import type { VoiceSessionState } from "../voice-join/voice-state";

export interface CameraMediaGraph {
  produceCamera(track: MediaStreamTrack): Promise<types.Producer>;
  createCameraConsumer(producerId: string): Promise<types.Consumer>;
}

/** Owns both camera capture and the video consumer for one direct-call session. */
export class CallCamera {
  private producer: types.Producer | null = null;
  private track: MediaStreamTrack | null = null;
  private consumer: types.Consumer | null = null;
  private remoteProducerId: string | null = null;
  private pendingRemoteProducerId: string | null = null;
  private remoteGeneration = 0;
  private ownElement: HTMLVideoElement | null = null;
  private remoteElement: HTMLVideoElement | null = null;
  private generation = 0;
  private pendingStop: { mediaRoomId: string; producerId: string } | null = null;
  private networkQuality: CallConnectionQuality = "unknown";
  private qualityGeneration = 0;

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly state: VoiceSessionState,
    private readonly media: CameraMediaGraph,
  ) {}

  async start(): Promise<void> {
    if (this.producer || useDirectCall.getState().cameraStatus === "starting") return;
    if (!this.state.isConnected || !useDirectCall.getState().mediaRoomId) {
      throw new Error("Call media is not connected");
    }
    const generation = ++this.generation;
    useDirectCall.getState().replace({ cameraStatus: "starting", cameraError: null });
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("Camera did not provide a video track");
      if (generation !== this.generation) return;
      this.track = track;
      this.attachOwn(this.ownElement);
      track.addEventListener("ended", this.onTrackEnded, { once: true });
      const producer = await this.media.produceCamera(track);
      if (generation !== this.generation) {
        producer.close();
        const mediaRoomId = this.state.channelId;
        if (mediaRoomId && this.signaling.connected) {
          await this.signaling.request<null>(VoiceClientEvent.CameraStop, {
            mediaRoomId,
            producerId: producer.id,
          });
        }
        return;
      }
      this.producer = producer;
      if (track.readyState !== "live") {
        await this.stop();
        return;
      }
      useDirectCall.getState().replace({ cameraStatus: "on" });
      await this.setNetworkQuality(this.networkQuality);
      await this.updateSwitchAvailability(generation);
    } catch (error: unknown) {
      if (generation === this.generation) {
        const producerId = this.producer?.id;
        const mediaRoomId = this.state.channelId;
        this.closeLocal();
        if (producerId && mediaRoomId && this.signaling.connected) {
          try {
            await this.signaling.request<null>(VoiceClientEvent.CameraStop, {
              mediaRoomId,
              producerId,
            });
          } catch (cleanupError: unknown) {
            console.error("Failed to clean up a partial camera publication", {
              error: cleanupError,
              mediaRoomId,
              producerId,
            });
          }
        }
        useDirectCall.getState().replace({
          cameraStatus: "error",
          cameraError: error instanceof Error ? error.message : "Camera is unavailable",
        });
      }
      throw error;
    } finally {
      if (generation !== this.generation) stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async stop(): Promise<void> {
    const mediaRoomId = this.state.channelId;
    const producerId = this.producer?.id;
    this.closeLocal();
    useDirectCall.getState().replace({
      cameraStatus: "off",
      cameraError: null,
      cameraSwitchAvailable: false,
      cameraNetworkPaused: false,
    });
    if (mediaRoomId && producerId) {
      if (this.signaling.connected) {
        try {
          await this.signaling.request<null>(VoiceClientEvent.CameraStop, {
            mediaRoomId,
            producerId,
          });
        } catch (error: unknown) {
          useDirectCall.getState().replace({
            cameraStatus: "error",
            cameraError: error instanceof Error ? error.message : "Could not stop camera on server",
          });
          throw error;
        }
      } else {
        this.pendingStop = { mediaRoomId, producerId };
      }
    }
  }

  async flushPendingStop(): Promise<void> {
    const pending = this.pendingStop;
    this.pendingStop = null;
    if (pending && pending.mediaRoomId === this.state.channelId && this.signaling.connected) {
      await this.signaling.request<null>(VoiceClientEvent.CameraStop, pending);
    }
  }

  async setNetworkQuality(quality: CallConnectionQuality): Promise<void> {
    this.networkQuality = quality;
    const qualityGeneration = ++this.qualityGeneration;
    const producer = this.producer;
    if (!producer || producer.closed) return;
    if (quality === "poor") {
      producer.pause();
      useDirectCall.getState().replace({ cameraNetworkPaused: true });
      return;
    }
    await producer.setRtpEncodingParameters({
      maxBitrate: quality === "good" ? 500_000 : 200_000,
    });
    if (
      producer.closed ||
      this.producer !== producer ||
      qualityGeneration !== this.qualityGeneration
    )
      return;
    producer.resume();
    useDirectCall.getState().replace({ cameraNetworkPaused: false });
  }

  async switchCamera(): Promise<void> {
    const oldTrack = this.track;
    const producer = this.producer;
    if (!oldTrack || !producer) return;
    const generation = this.generation;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
    const currentId = oldTrack.getSettings().deviceId;
    const next = devices.find((device) => device.deviceId !== currentId);
    if (!next) return;
    useDirectCall.getState().replace({ cameraStatus: "starting", cameraError: null });
    let replacement: MediaStreamTrack | null = null;
    try {
      try {
        replacement =
          (
            await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: next.deviceId },
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 24, max: 30 },
              },
            })
          ).getVideoTracks()[0] ?? null;
      } catch (error: unknown) {
        if (!(error instanceof DOMException) || error.name !== "NotReadableError") throw error;
        oldTrack.removeEventListener("ended", this.onTrackEnded);
        oldTrack.stop();
        replacement =
          (
            await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { deviceId: { exact: next.deviceId } },
            })
          ).getVideoTracks()[0] ?? null;
      }
      if (!replacement) throw new Error("Camera did not provide a video track");
      if (generation !== this.generation) {
        replacement.stop();
        return;
      }
      await producer.replaceTrack({ track: replacement });
      if (generation !== this.generation) {
        replacement.stop();
        return;
      }
      oldTrack.removeEventListener("ended", this.onTrackEnded);
      oldTrack.stop();
      this.track = replacement;
      replacement.addEventListener("ended", this.onTrackEnded, { once: true });
      this.attachOwn(this.ownElement);
      useDirectCall.getState().replace({ cameraStatus: "on" });
    } catch (error: unknown) {
      replacement?.stop();
      if (generation !== this.generation) return;
      if (oldTrack.readyState !== "live") await this.stop();
      useDirectCall.getState().replace({
        cameraStatus: oldTrack.readyState === "live" ? "on" : "error",
        cameraError: error instanceof Error ? error.message : "Cannot switch camera",
      });
      throw error;
    }
  }

  async consume(userId: string, producerId: string): Promise<void> {
    const { call, mediaRoomId } = useDirectCall.getState();
    const self = sessionUserId();
    if (
      !call ||
      call.status !== "ACTIVE" ||
      mediaRoomId !== this.state.channelId ||
      userId === self ||
      ![call.caller.id, call.callee.id].includes(userId)
    )
      return;
    if (this.remoteProducerId === producerId || this.pendingRemoteProducerId === producerId) return;
    this.closeRemote();
    const generation = this.generation;
    const remoteGeneration = ++this.remoteGeneration;
    this.pendingRemoteProducerId = producerId;
    let consumer: types.Consumer;
    try {
      consumer = await this.media.createCameraConsumer(producerId);
    } catch (error: unknown) {
      if (remoteGeneration === this.remoteGeneration) this.pendingRemoteProducerId = null;
      throw error;
    }
    if (generation !== this.generation || remoteGeneration !== this.remoteGeneration) {
      consumer.close();
      return;
    }
    this.pendingRemoteProducerId = null;
    this.consumer = consumer;
    this.remoteProducerId = producerId;
    const stream = new MediaStream([consumer.track]);
    useDirectCall.getState().replace({ remoteCamera: stream });
    this.attachRemote(this.remoteElement);
    try {
      await this.signaling.request<null>(VoiceClientEvent.ResumeConsumer, {
        consumerId: consumer.id,
      });
    } catch (error: unknown) {
      if (remoteGeneration === this.remoteGeneration) this.closeRemote();
      throw error;
    }
  }

  closed(producerId: string): void {
    if (this.remoteProducerId === producerId) this.closeRemote();
    if (this.producer?.id === producerId) {
      this.closeLocal();
      useDirectCall
        .getState()
        .replace({ cameraStatus: "off", cameraSwitchAvailable: false, cameraNetworkPaused: false });
    }
  }

  attachOwn(element: HTMLVideoElement | null): void {
    this.ownElement = element;
    if (element) element.srcObject = this.track ? new MediaStream([this.track]) : null;
  }

  attachRemote(element: HTMLVideoElement | null): void {
    this.remoteElement = element;
    if (element) element.srcObject = useDirectCall.getState().remoteCamera;
  }

  close(): void {
    this.pendingStop = null;
    this.closeLocal();
    this.closeRemote();
    useDirectCall.getState().replace({
      cameraStatus: "off",
      cameraError: null,
      cameraSwitchAvailable: false,
      cameraNetworkPaused: false,
    });
  }

  private closeLocal(): void {
    this.generation += 1;
    this.track?.removeEventListener("ended", this.onTrackEnded);
    this.producer?.close();
    this.track?.stop();
    this.producer = null;
    this.track = null;
    if (this.ownElement) this.ownElement.srcObject = null;
  }

  private closeRemote(): void {
    this.remoteGeneration += 1;
    this.pendingRemoteProducerId = null;
    this.consumer?.close();
    this.consumer = null;
    this.remoteProducerId = null;
    if (this.remoteElement) this.remoteElement.srcObject = null;
    useDirectCall.getState().replace({ remoteCamera: null });
  }

  private async updateSwitchAvailability(generation: number): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (generation !== this.generation) return;
      useDirectCall.getState().replace({
        cameraSwitchAvailable: devices.filter((device) => device.kind === "videoinput").length > 1,
      });
    } catch (error: unknown) {
      console.warn("Cannot enumerate cameras", { error });
      if (generation !== this.generation) return;
      useDirectCall.getState().replace({ cameraSwitchAvailable: false });
    }
  }

  private readonly onTrackEnded = (): void => {
    void this.stop().catch((error: unknown) => {
      console.error("Failed to stop ended call camera", { error });
      useDirectCall
        .getState()
        .replace({ cameraStatus: "error", cameraError: "Camera stopped unexpectedly" });
    });
  };
}
