import type { CallConnectionQuality } from "@voreli/shared";

import { sessionUserId, type OwnUserId } from "../voice-join/voice-identity";
import type { VoiceSignaling } from "../voice-join/voice-signaling";
import { BrowserCameraCapture, type CameraCapture } from "./camera-capture";
import type { CameraMediaGraph, CameraVoiceRoom } from "./camera-media";
import { CameraNetworkAdaptation } from "./camera-network-adaptation";
import { CameraPublication } from "./camera-publication";
import { CameraServerRelease } from "./camera-server-release";
import { CameraVideoBinding } from "./camera-video-binding";
import { DirectCallState } from "./direct-call-state";
import { RemoteCameraReceiver } from "./remote-camera";

/**
 * The camera of one direct-call session, assembled from its parts.
 *
 * It decides nothing itself: our publication, the peer's consumer, the network adaptation
 * and the two video bindings each own their piece, and this object only routes the
 * session's commands and server events to the piece they concern.
 */
export class CallCamera {
  private readonly ownView = new CameraVideoBinding();
  private readonly remoteView = new CameraVideoBinding();
  private readonly adaptation: CameraNetworkAdaptation;
  private readonly release: CameraServerRelease;
  private readonly publication: CameraPublication;
  private readonly remote: RemoteCameraReceiver;

  constructor(
    signaling: VoiceSignaling,
    room: CameraVoiceRoom,
    media: CameraMediaGraph,
    state: DirectCallState = new DirectCallState(),
    capture: CameraCapture = new BrowserCameraCapture(),
    self: OwnUserId = sessionUserId,
  ) {
    this.adaptation = new CameraNetworkAdaptation(state);
    this.release = new CameraServerRelease(signaling, room);
    this.publication = new CameraPublication(
      room,
      state,
      media,
      capture,
      this.release,
      this.adaptation,
      this.ownView,
    );
    this.remote = new RemoteCameraReceiver(signaling, room, state, media, this.remoteView, self);
  }

  start(): Promise<void> {
    return this.publication.start();
  }

  stop(): Promise<void> {
    return this.publication.stop();
  }

  switchCamera(): Promise<void> {
    return this.publication.switchCamera();
  }

  flushPendingStop(): Promise<void> {
    return this.release.flush();
  }

  setNetworkQuality(quality: CallConnectionQuality): Promise<void> {
    return this.adaptation.setQuality(quality);
  }

  consume(userId: string, producerId: string): Promise<void> {
    return this.remote.consume(userId, producerId);
  }

  closed(producerId: string): void {
    this.remote.closed(producerId);
    this.publication.closed(producerId);
  }

  attachOwn(element: HTMLVideoElement | null): void {
    this.ownView.attach(element);
  }

  attachRemote(element: HTMLVideoElement | null): void {
    this.remoteView.attach(element);
  }

  close(): void {
    this.publication.close();
    this.remote.close();
  }
}
