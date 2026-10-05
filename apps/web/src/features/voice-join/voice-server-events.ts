import {
  type VoiceErrorEvent,
  type VoiceParticipantJoinedEvent,
  type VoiceParticipantLeftEvent,
  type VoiceParticipantUpdatedEvent,
  type VoiceParticipantView,
  type VoiceProducerClosedEvent,
  type VoiceProducerEvent,
  VoiceServerEvent,
  type VoiceSpeakingEvent,
  type ScreenShareEvent,
  type ScreenShareStoppedEvent,
} from "@voreli/shared";

import { VoiceRequestError } from "./voice-request-error";
import { sessionUserId } from "./voice-identity";
import type { VoiceSignaling } from "./voice-signaling";
import type { VoiceSessionState } from "./voice-state";

/** The two session-wide transitions the socket can force from outside a user action. */
export interface VoiceSessionLifecycle {
  /** The socket came back while a server-side session is still alive. */
  reconnect(): void;
  /** The server withdrew the right to be here; tear everything down. */
  forceLeave(): void;
}

/**
 * The slice of VoiceMedia these listeners are allowed to touch.
 *
 * Narrowed rather than taking the whole object so that reacting to a server event cannot grow
 * into rebuilding transports, and so a test can drive the listeners with a recording stand-in
 * instead of a live mediasoup graph.
 */
export interface VoiceMediaControl {
  consumeRemote(userId: string, producerId: string): Promise<void>;
  closeProducer(producerId: string): void;
  closeReceived(producerId: string): void;
  setParticipantState(participant: VoiceParticipantView): Promise<void>;
}

/** The server's authoritative half of the speaking indicator. */
export interface RemoteSpeakers {
  setRemote(userIds: readonly string[]): void;
}

export interface ScreenShareViewing {
  updated(screenShare: ScreenShareEvent["screenShare"]): void;
  stopped(screenStreamId: string): void;
}

export interface ScreenSharePublishing {
  stopped(screenStreamId: string): void;
}

export interface CallCameraEvents {
  consume(userId: string, producerId: string): Promise<void>;
  closed(producerId: string): void;
  stop(): Promise<void>;
}

interface VoiceServerEventDeps {
  readonly state: VoiceSessionState;
  readonly media: VoiceMediaControl;
  readonly speaking: RemoteSpeakers;
  readonly screenViewing: ScreenShareViewing;
  readonly screenPublishing: ScreenSharePublishing;
  readonly camera: CallCameraEvents;
  readonly lifecycle: VoiceSessionLifecycle;
}

/**
 * Translates server events into state transitions and media lifecycle calls.
 *
 * This is pure translation and holds nothing itself, which is why it is a function over
 * collaborators rather than another object: every fact it needs already lives in the state.
 */
export function bindVoiceServerEvents(
  signaling: VoiceSignaling,
  {
    state,
    media,
    speaking,
    screenViewing,
    screenPublishing,
    camera,
    lifecycle,
  }: VoiceServerEventDeps,
): void {
  signaling.on("disconnect", () => {
    if (state.isActive) state.reconnecting();
    void camera.stop().catch((error: unknown) => {
      console.error("Failed to release camera after voice socket disconnect", { error });
      state.failed(error);
    });
  });

  signaling.on("connect", () => {
    if (state.isActive) lifecycle.reconnect();
  });

  signaling.on<VoiceParticipantJoinedEvent>(VoiceServerEvent.ParticipantJoined, (event) => {
    state.upsertParticipant(event.participant);
  });

  signaling.on<VoiceParticipantUpdatedEvent>(VoiceServerEvent.ParticipantUpdated, (event) => {
    state.upsertParticipant(event.participant);
    void media.setParticipantState(event.participant).catch((error: unknown) => {
      console.error("Failed to apply remote voice participant state", { error });
      state.failed(error);
    });
  });

  signaling.on<VoiceParticipantLeftEvent>(VoiceServerEvent.ParticipantLeft, (event) => {
    // Read the producers before removing the participant: afterwards there is nothing left
    // to say which audio elements were theirs.
    state.participant(event.userId)?.producers.forEach((producer) => {
      media.closeReceived(producer.producerId);
      camera.closed(producer.producerId);
    });
    state.removeParticipant(event.userId);
  });

  signaling.on<VoiceProducerEvent>(VoiceServerEvent.ProducerNew, (event) => {
    state.addProducer(event.userId, {
      producerId: event.producerId,
      kind: event.kind,
      source: event.source,
      screenStreamId: event.screenStreamId,
    });
    if (event.source === "microphone") {
      void media
        .consumeRemote(event.userId, event.producerId)
        .catch((error: unknown) => state.failed(error));
    } else if (event.source === "camera-video" && event.userId !== sessionUserId()) {
      void camera
        .consume(event.userId, event.producerId)
        .catch((error: unknown) => state.failed(error));
    }
  });

  signaling.on<VoiceProducerClosedEvent>(VoiceServerEvent.ProducerClosed, (event) => {
    media.closeProducer(event.producerId);
    media.closeReceived(event.producerId);
    camera.closed(event.producerId);
    state.removeProducer(event.producerId);
  });

  signaling.on<VoiceSpeakingEvent>(VoiceServerEvent.Speaking, (event) => {
    speaking.setRemote(event.speaking.map((speaker) => speaker.userId));
  });

  signaling.on<ScreenShareEvent>(VoiceServerEvent.ScreenStarted, ({ screenShare }) => {
    state.upsertScreenShare(screenShare);
  });

  signaling.on<ScreenShareEvent>(VoiceServerEvent.ScreenUpdated, ({ screenShare }) => {
    screenViewing.updated(screenShare);
    state.upsertScreenShare(screenShare);
  });

  signaling.on<ScreenShareStoppedEvent>(VoiceServerEvent.ScreenStopped, (event) => {
    screenPublishing.stopped(event.screenStreamId);
    screenViewing.stopped(event.screenStreamId);
    state.removeScreenShare(event.screenStreamId);
  });

  signaling.on<VoiceErrorEvent>(VoiceServerEvent.Error, (event) => {
    state.failed(new VoiceRequestError(event.errorCode, event.message));
    if (event.errorCode === "VOICE_CONNECT_FORBIDDEN") lifecycle.forceLeave();
  });
}
