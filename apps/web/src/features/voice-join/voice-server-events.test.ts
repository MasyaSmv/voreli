import {
  type VoiceParticipantView,
  VoiceServerEvent,
  type VoiceSpeakingEvent,
} from "@voreli/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useVoice } from "../../entities/voice/voice.store";
import {
  bindVoiceServerEvents,
  type RemoteSpeakers,
  type VoiceMediaControl,
  type VoiceSessionLifecycle,
} from "./voice-server-events";
import type { VoiceSignaling } from "./voice-signaling";
import { VoiceSessionState } from "./voice-state";

/**
 * A signaling channel that answers nothing and only delivers what the test pushes into it.
 *
 * A real implementation of the contract rather than a patched socket: the listeners under
 * test only ever subscribe, so this is the whole of what they can observe.
 */
class TestSignaling implements VoiceSignaling {
  readonly connected = true;
  private readonly listeners = new Map<string, ((payload: never) => void)[]>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  request<T>(event: string): Promise<T> {
    return Promise.reject(new Error(`unexpected request ${event}`));
  }

  on<E>(event: string, listener: (payload: E) => void): void {
    const existing = this.listeners.get(event) ?? [];
    this.listeners.set(event, [...existing, listener]);
  }

  deliver<E>(event: string, payload: E): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (value: E) => void)(payload);
    }
  }
}

/** Records what the listeners asked of the media graph, with no graph to build. */
class RecordingMedia implements VoiceMediaControl {
  readonly consumed: { userId: string; producerId: string }[] = [];
  readonly closedProducers: string[] = [];
  readonly closedReceived: string[] = [];

  consumeRemote(userId: string, producerId: string): Promise<void> {
    this.consumed.push({ userId, producerId });
    return Promise.resolve();
  }

  closeProducer(producerId: string): void {
    this.closedProducers.push(producerId);
  }

  closeReceived(producerId: string): void {
    this.closedReceived.push(producerId);
  }
}

class RecordingSpeakers implements RemoteSpeakers {
  latest: readonly string[] = [];

  setRemote(userIds: readonly string[]): void {
    this.latest = userIds;
  }
}

class RecordingLifecycle implements VoiceSessionLifecycle {
  reconnects = 0;
  forcedLeaves = 0;

  reconnect(): void {
    this.reconnects += 1;
  }

  forceLeave(): void {
    this.forcedLeaves += 1;
  }
}

const bob: VoiceParticipantView = {
  userId: "user-bob",
  selfMuted: false,
  selfDeafened: false,
  producers: [{ producerId: "producer-bob", kind: "audio" }],
};

describe("bindVoiceServerEvents", () => {
  const state = new VoiceSessionState();
  let signaling: TestSignaling;
  let media: RecordingMedia;
  let speaking: RecordingSpeakers;
  let lifecycle: RecordingLifecycle;

  beforeEach(() => {
    signaling = new TestSignaling();
    media = new RecordingMedia();
    speaking = new RecordingSpeakers();
    lifecycle = new RecordingLifecycle();
    bindVoiceServerEvents(signaling, { state, media, speaking, lifecycle });
  });

  afterEach(() => {
    state.idle({ clearError: true });
  });

  it("ignores socket churn while no session exists", () => {
    signaling.deliver("disconnect", undefined);
    signaling.deliver("connect", undefined);

    expect(useVoice.getState().connection).toBe("idle");
    expect(lifecycle.reconnects).toBe(0);
  });

  it("marks a live session as reconnecting and resumes it when the socket returns", () => {
    state.joined("channel-one", "session-one", []);

    signaling.deliver("disconnect", undefined);
    expect(useVoice.getState().connection).toBe("reconnecting");

    signaling.deliver("connect", undefined);
    expect(lifecycle.reconnects).toBe(1);
  });

  it("records a new producer and starts consuming it", () => {
    state.joined("channel-one", "session-one", [{ ...bob, producers: [] }]);

    signaling.deliver(VoiceServerEvent.ProducerNew, {
      userId: bob.userId,
      producerId: "producer-bob",
      kind: "audio" as const,
    });

    expect(state.participant(bob.userId)?.producers).toEqual([
      { producerId: "producer-bob", kind: "audio" },
    ]);
    expect(media.consumed).toEqual([{ userId: bob.userId, producerId: "producer-bob" }]);
  });

  // Own audio is filtered inside VoiceMedia, so the listener hands it over unconditionally:
  // deciding twice is how the echo feature would quietly break.
  it("hands every new producer to the media layer, including its own", () => {
    state.joined("channel-one", "session-one", []);

    signaling.deliver(VoiceServerEvent.ProducerNew, {
      userId: "user-alice",
      producerId: "producer-alice",
      kind: "audio" as const,
    });

    expect(media.consumed).toEqual([{ userId: "user-alice", producerId: "producer-alice" }]);
  });

  it("closes the audio of someone who left before forgetting which audio was theirs", () => {
    state.joined("channel-one", "session-one", [bob]);

    signaling.deliver(VoiceServerEvent.ParticipantLeft, { userId: bob.userId });

    expect(media.closedReceived).toEqual(["producer-bob"]);
    expect(useVoice.getState().participants).toEqual([]);
  });

  it("drops a closed producer from both the graph and the participant", () => {
    state.joined("channel-one", "session-one", [bob]);

    signaling.deliver(VoiceServerEvent.ProducerClosed, { producerId: "producer-bob" });

    expect(media.closedProducers).toEqual(["producer-bob"]);
    expect(media.closedReceived).toEqual(["producer-bob"]);
    expect(state.participant(bob.userId)?.producers).toEqual([]);
  });

  it("passes the server's speakers on without the levels", () => {
    const event: VoiceSpeakingEvent = {
      speaking: [
        { userId: bob.userId, level: -30 },
        { userId: "user-carol", level: -42 },
      ],
    };

    signaling.deliver(VoiceServerEvent.Speaking, event);

    expect(speaking.latest).toEqual([bob.userId, "user-carol"]);
  });

  it("shows any server error but only tears down when the right to be here is gone", () => {
    state.joined("channel-one", "session-one", [bob]);

    signaling.deliver(VoiceServerEvent.Error, {
      errorCode: "VOICE_SPEAK_FORBIDDEN",
      message: "Нет права говорить",
    });
    expect(useVoice.getState().error).toBe("Нет права говорить");
    expect(lifecycle.forcedLeaves).toBe(0);

    signaling.deliver(VoiceServerEvent.Error, {
      errorCode: "VOICE_CONNECT_FORBIDDEN",
      message: "Нет права подключаться",
    });
    expect(lifecycle.forcedLeaves).toBe(1);
  });
});
