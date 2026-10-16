/**
 * The media-side contracts the call camera is built on, each cut to what camera code uses.
 *
 * mediasoup's own `types.Producer`/`types.Consumer` satisfy the producer and consumer
 * shapes structurally; narrowing them is what lets a test supply its own in-memory ones.
 */

export interface CameraProducer {
  readonly id: string;
  readonly closed: boolean;
  close(): void;
  pause(): void;
  resume(): void;
  setRtpEncodingParameters(params: RTCRtpEncodingParameters): Promise<void>;
  replaceTrack(options: { track: MediaStreamTrack | null }): Promise<void>;
}

export interface CameraConsumer {
  readonly id: string;
  readonly track: MediaStreamTrack;
  close(): void;
}

export interface CameraMediaGraph {
  produceCamera(track: MediaStreamTrack): Promise<CameraProducer>;
  createCameraConsumer(producerId: string): Promise<CameraConsumer>;
}

/** Where a camera track is shown. The DOM binding is one; a test records what it was shown. */
export interface CameraView {
  show(track: MediaStreamTrack | null): void;
}

/** The voice room the call media lives in, as camera code needs to see it. */
export interface CameraVoiceRoom {
  readonly channelId: string | null;
  readonly isConnected: boolean;
}
