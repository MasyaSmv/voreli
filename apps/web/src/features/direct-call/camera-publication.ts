import type { CallCameraStatus } from "../../entities/direct-call/direct-call.store";
import type { CameraCapture } from "./camera-capture";
import type { CameraMediaGraph, CameraProducer, CameraView, CameraVoiceRoom } from "./camera-media";
import type { CameraAdaptation } from "./camera-network-adaptation";
import type { CameraServerRelease } from "./camera-server-release";

/** The camera's slice of the direct-call state: its own status, nothing about the call. */
export interface CameraPublicationState {
  readonly mediaRoomId: string | null;
  readonly cameraStatus: CallCameraStatus;
  cameraStarting(): void;
  cameraOn(): void;
  cameraFailed(message: string, status?: "on" | "error"): void;
  cameraOff(): void;
  cameraEnded(): void;
  cameraSwitchAvailable(available: boolean): void;
}

/**
 * Our own camera in a call: from the capture prompt to the producer and back to nothing.
 *
 * Every step awaits something — the prompt, the producer, the device switch — and a stop or
 * a session change may land during any of them. `generation` is how a step that wakes up
 * late learns it was overtaken: every close bumps it, and a step that finds a different
 * value releases whatever it acquired instead of installing it.
 */
export class CameraPublication {
  private producer: CameraProducer | null = null;
  private track: MediaStreamTrack | null = null;
  private generation = 0;

  constructor(
    private readonly room: CameraVoiceRoom,
    private readonly state: CameraPublicationState,
    private readonly media: Pick<CameraMediaGraph, "produceCamera">,
    private readonly capture: CameraCapture,
    private readonly release: CameraServerRelease,
    private readonly adaptation: CameraAdaptation,
    private readonly preview: CameraView,
  ) {}

  async start(): Promise<void> {
    if (this.producer || this.state.cameraStatus === "starting") return;
    if (!this.room.isConnected || !this.state.mediaRoomId) {
      throw new Error("Call media is not connected");
    }
    const generation = ++this.generation;
    this.state.cameraStarting();
    let captured: MediaStreamTrack | null = null;
    try {
      const track = await this.capture.open();
      captured = track;
      if (generation !== this.generation) return;
      this.track = track;
      this.preview.show(track);
      track.addEventListener("ended", this.onTrackEnded, { once: true });
      const producer = await this.media.produceCamera(track);
      if (generation !== this.generation) {
        producer.close();
        await this.release.stopIfConnected(this.room.channelId, producer.id);
        return;
      }
      this.producer = producer;
      if (track.readyState !== "live") {
        await this.stop();
        return;
      }
      this.state.cameraOn();
      await this.adaptation.publish(producer);
      await this.updateSwitchAvailability(generation);
    } catch (error: unknown) {
      if (generation === this.generation) {
        const producerId = this.producer?.id;
        const mediaRoomId = this.room.channelId;
        this.closeLocal();
        if (producerId) await this.releasePartial(mediaRoomId, producerId);
        this.state.cameraFailed(error instanceof Error ? error.message : "Camera is unavailable");
      }
      throw error;
    } finally {
      // An overtaken or failed start must not leave the camera light on.
      if (generation !== this.generation) captured?.stop();
    }
  }

  async stop(): Promise<void> {
    const mediaRoomId = this.room.channelId;
    const producerId = this.producer?.id;
    this.closeLocal();
    this.state.cameraOff();
    if (!mediaRoomId || !producerId) return;
    try {
      await this.release.stop(mediaRoomId, producerId);
    } catch (error: unknown) {
      this.state.cameraFailed(
        error instanceof Error ? error.message : "Could not stop camera on server",
      );
      throw error;
    }
  }

  async switchCamera(): Promise<void> {
    const oldTrack = this.track;
    const producer = this.producer;
    if (!oldTrack || !producer) return;
    const generation = this.generation;
    const inputs = await this.capture.videoInputs();
    const currentId = oldTrack.getSettings().deviceId;
    const next = inputs.find((deviceId) => deviceId !== currentId);
    if (next === undefined) return;
    this.state.cameraStarting();
    let replacement: MediaStreamTrack | null = null;
    try {
      try {
        replacement = await this.capture.openDevice(next, true);
      } catch (error: unknown) {
        // Phones often drive one camera at a time: the new one is busy until the old one
        // lets go, so release it and ask again without hints the driver could refuse.
        if (!(error instanceof DOMException) || error.name !== "NotReadableError") throw error;
        this.releaseTrack(oldTrack);
        replacement = await this.capture.openDevice(next, false);
      }
      if (generation !== this.generation) {
        replacement.stop();
        return;
      }
      await producer.replaceTrack({ track: replacement });
      if (generation !== this.generation) {
        replacement.stop();
        return;
      }
      this.releaseTrack(oldTrack);
      this.track = replacement;
      replacement.addEventListener("ended", this.onTrackEnded, { once: true });
      this.preview.show(replacement);
      this.state.cameraOn();
    } catch (error: unknown) {
      replacement?.stop();
      if (generation !== this.generation) {
        console.warn("An overtaken camera switch failed", { error });
        return;
      }
      if (oldTrack.readyState !== "live") await this.stop();
      this.state.cameraFailed(
        error instanceof Error ? error.message : "Cannot switch camera",
        oldTrack.readyState === "live" ? "on" : "error",
      );
      throw error;
    }
  }

  /** The server closed our producer; the stop it would expect from us has already happened. */
  closed(producerId: string): void {
    if (this.producer?.id !== producerId) return;
    this.closeLocal();
    this.state.cameraEnded();
  }

  /** The session itself is going away: nothing is owed to its room any more. */
  close(): void {
    this.release.forget();
    this.closeLocal();
    this.state.cameraOff();
  }

  private closeLocal(): void {
    this.generation += 1;
    this.track?.removeEventListener("ended", this.onTrackEnded);
    this.producer?.close();
    this.track?.stop();
    this.producer = null;
    this.track = null;
    this.adaptation.release();
    this.preview.show(null);
  }

  private releaseTrack(track: MediaStreamTrack): void {
    track.removeEventListener("ended", this.onTrackEnded);
    track.stop();
  }

  private async releasePartial(mediaRoomId: string | null, producerId: string): Promise<void> {
    try {
      await this.release.stopIfConnected(mediaRoomId, producerId);
    } catch (error: unknown) {
      console.error("Failed to clean up a partial camera publication", {
        error,
        mediaRoomId,
        producerId,
      });
    }
  }

  private async updateSwitchAvailability(generation: number): Promise<void> {
    try {
      const inputs = await this.capture.videoInputs();
      if (generation !== this.generation) return;
      this.state.cameraSwitchAvailable(inputs.length > 1);
    } catch (error: unknown) {
      console.warn("Cannot enumerate cameras", { error });
      if (generation !== this.generation) return;
      this.state.cameraSwitchAvailable(false);
    }
  }

  private readonly onTrackEnded = (): void => {
    void this.stop().catch((error: unknown) => {
      console.error("Failed to stop ended call camera", { error });
      this.state.cameraFailed("Camera stopped unexpectedly");
    });
  };
}
