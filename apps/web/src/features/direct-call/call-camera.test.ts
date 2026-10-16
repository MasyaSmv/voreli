import { type CallConnectionQuality, type DirectCallView, VoiceClientEvent } from "@voreli/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import type { VoiceSignaling } from "../voice-join/voice-signaling";
import { VoiceSessionState } from "../voice-join/voice-state";
import { CallCamera } from "./call-camera";
import type { CameraCapture } from "./camera-capture";
import type { CameraConsumer, CameraMediaGraph, CameraProducer, CameraView } from "./camera-media";
import { CameraNetworkAdaptation } from "./camera-network-adaptation";
import { CameraPublication } from "./camera-publication";
import { CameraServerRelease } from "./camera-server-release";
import { DirectCallState } from "./direct-call-state";
import { RemoteCameraReceiver } from "./remote-camera";

/** A promise the test settles by hand, to land an event exactly inside an await. */
class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/**
 * A camera track without a camera. jsdom has no media devices, so this is a real
 * implementation of the track contract: it ends when stopped by the hardware (`endByDevice`)
 * and, like a browser track, does not fire `ended` when stopped by the page.
 */
class TestTrack extends EventTarget implements MediaStreamTrack {
  readonly kind = "video";
  readonly id: string;
  readonly label: string;
  contentHint = "";
  enabled = true;
  readonly muted = false;
  onended: ((this: MediaStreamTrack, event: Event) => unknown) | null = null;
  onmute: ((this: MediaStreamTrack, event: Event) => unknown) | null = null;
  onunmute: ((this: MediaStreamTrack, event: Event) => unknown) | null = null;
  readyState: MediaStreamTrackState = "live";

  constructor(readonly deviceId: string) {
    super();
    this.id = `track-${deviceId}`;
    this.label = deviceId;
  }

  stop(): void {
    this.readyState = "ended";
  }

  endByDevice(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }

  getSettings(): MediaTrackSettings {
    return { deviceId: this.deviceId };
  }

  getCapabilities(): MediaTrackCapabilities {
    return { deviceId: this.deviceId };
  }

  getConstraints(): MediaTrackConstraints {
    return {};
  }

  applyConstraints(): Promise<void> {
    return Promise.resolve();
  }

  clone(): MediaStreamTrack {
    return new TestTrack(this.deviceId);
  }
}

/** Cameras as a list of device ids; each open hands out a fresh track or a queued failure. */
class TestCapture implements CameraCapture {
  readonly opened: { deviceId: string; constrained: boolean | null }[] = [];
  readonly failures: Error[] = [];
  pendingOpen: Deferred<void> | null = null;

  constructor(readonly devices: string[] = ["front"]) {}

  async open(): Promise<MediaStreamTrack> {
    return this.give(this.devices[0] ?? "front", null);
  }

  async openDevice(deviceId: string, constrained: boolean): Promise<MediaStreamTrack> {
    return this.give(deviceId, constrained);
  }

  videoInputs(): Promise<readonly string[]> {
    return Promise.resolve([...this.devices]);
  }

  private async give(deviceId: string, constrained: boolean | null): Promise<TestTrack> {
    this.opened.push({ deviceId, constrained });
    if (this.pendingOpen) await this.pendingOpen.promise;
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    return new TestTrack(deviceId);
  }
}

class TestProducer implements CameraProducer {
  closed = false;
  paused = false;
  readonly encodings: RTCRtpEncodingParameters[] = [];
  readonly replacedWith: (MediaStreamTrack | null)[] = [];
  pendingEncoding: Deferred<void> | null = null;

  constructor(
    readonly id: string,
    public track: MediaStreamTrack,
  ) {}

  close(): void {
    this.closed = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async setRtpEncodingParameters(params: RTCRtpEncodingParameters): Promise<void> {
    this.encodings.push(params);
    const pending = this.pendingEncoding;
    this.pendingEncoding = null;
    if (pending) await pending.promise;
  }

  replaceTrack({ track }: { track: MediaStreamTrack | null }): Promise<void> {
    this.replacedWith.push(track);
    return Promise.resolve();
  }
}

class TestConsumer implements CameraConsumer {
  closed = false;
  readonly track: MediaStreamTrack;

  constructor(readonly producerId: string) {
    this.id = `consumer-${producerId}`;
    this.track = new TestTrack(`remote-${producerId}`);
  }

  readonly id: string;

  close(): void {
    this.closed = true;
  }
}

/** The send and receive side of the call media, with every producer and consumer kept. */
class TestMediaGraph implements CameraMediaGraph {
  readonly producers: TestProducer[] = [];
  readonly consumers: TestConsumer[] = [];
  pendingProduce: Deferred<void> | null = null;
  readonly pendingConsumers = new Map<string, Deferred<void>>();
  produceFailure: Error | null = null;
  /** Handed to the next producer: its first bitrate change waits for this. */
  encodingGate: Deferred<void> | null = null;

  async produceCamera(track: MediaStreamTrack): Promise<CameraProducer> {
    if (this.pendingProduce) await this.pendingProduce.promise;
    if (this.produceFailure) throw this.produceFailure;
    const producer = new TestProducer(`camera-${this.producers.length + 1}`, track);
    producer.pendingEncoding = this.encodingGate;
    this.encodingGate = null;
    this.producers.push(producer);
    return producer;
  }

  async createCameraConsumer(producerId: string): Promise<CameraConsumer> {
    const pending = this.pendingConsumers.get(producerId);
    if (pending) await pending.promise;
    const consumer = new TestConsumer(producerId);
    this.consumers.push(consumer);
    return consumer;
  }
}

/** Answers every request with success unless told to fail one event; records them all. */
class TestSignaling implements VoiceSignaling {
  connected = true;
  readonly requests: { event: string; payload: unknown }[] = [];
  readonly failing = new Set<string>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  request<T>(event: string, payload: unknown): Promise<T> {
    this.requests.push({ event, payload });
    if (this.failing.has(event)) return Promise.reject(new Error(`${event} refused`));
    return Promise.resolve(null as T);
  }

  on(): void {}

  sent(event: string): unknown[] {
    return this.requests.filter((request) => request.event === event).map(({ payload }) => payload);
  }
}

class RecordingView implements CameraView {
  readonly shown: (MediaStreamTrack | null)[] = [];

  show(track: MediaStreamTrack | null): void {
    this.shown.push(track);
  }

  get current(): MediaStreamTrack | null | undefined {
    return this.shown.at(-1);
  }
}

const roomId = "direct-call:call-id";
const alice = { id: "alice-id", username: "alice", displayName: "Alice", avatarUrl: null };
const bob = { id: "bob-id", username: "bob", displayName: "Bob", avatarUrl: null };
const activeCall: DirectCallView = {
  id: "call-id",
  conversationId: "conversation-id",
  caller: { ...alice, createdAt: "2026-10-16T00:00:00.000Z" },
  callee: { ...bob, createdAt: "2026-10-16T00:00:00.000Z" },
  status: "ACTIVE",
  createdAt: "2026-10-16T00:00:00.000Z",
  answeredAt: "2026-10-16T00:00:01.000Z",
  endedAt: null,
  endedById: null,
};

/** Lets every already-settled continuation run, so a test can look between awaits. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

const voice = new VoiceSessionState();
const call = new DirectCallState();

beforeEach(() => {
  voice.joined(roomId, "session-id", []);
  voice.connected();
  call.activated(activeCall, roomId);
});

afterEach(() => {
  voice.idle({ clearError: true });
  call.reset();
});

function publication(
  options: {
    capture?: TestCapture;
    media?: TestMediaGraph;
    signaling?: TestSignaling;
    adaptation?: CameraNetworkAdaptation;
  } = {},
) {
  const capture = options.capture ?? new TestCapture();
  const media = options.media ?? new TestMediaGraph();
  const signaling = options.signaling ?? new TestSignaling();
  const adaptation = options.adaptation ?? new CameraNetworkAdaptation(call);
  const release = new CameraServerRelease(signaling, voice);
  const preview = new RecordingView();
  const camera = new CameraPublication(voice, call, media, capture, release, adaptation, preview);
  return { camera, capture, media, signaling, adaptation, release, preview };
}

describe("CameraPublication", () => {
  it("publishes the captured track, previews it and offers a switch only with two cameras", async () => {
    const { camera, media, preview } = publication({ capture: new TestCapture(["front", "back"]) });

    await camera.start();

    expect(media.producers).toHaveLength(1);
    expect(preview.current).toBe(media.producers[0]?.track);
    expect(useDirectCall.getState()).toMatchObject({
      cameraStatus: "on",
      cameraError: null,
      cameraSwitchAvailable: true,
    });
  });

  it("starts paused when the link was already poor before the camera came on", async () => {
    const adaptation = new CameraNetworkAdaptation(call);
    await adaptation.setQuality("poor");
    const { camera, media } = publication({ adaptation });

    await camera.start();

    expect(media.producers[0]?.paused).toBe(true);
    expect(useDirectCall.getState().cameraNetworkPaused).toBe(true);
  });

  it("releases a producer that arrives after the camera was already stopped", async () => {
    const media = new TestMediaGraph();
    media.pendingProduce = new Deferred();
    const { camera, signaling, capture, preview } = publication({ media });

    const starting = camera.start();
    await settle();
    await camera.stop();
    media.pendingProduce.resolve();
    await starting;

    const producer = media.producers[0];
    expect(producer?.closed).toBe(true);
    expect(producer?.track.readyState).toBe("ended");
    expect(capture.opened).toHaveLength(1);
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toEqual([
      { mediaRoomId: roomId, producerId: producer?.id },
    ]);
    expect(preview.current).toBeNull();
    expect(useDirectCall.getState().cameraStatus).toBe("off");
  });

  it("drops a capture that resolves after the session closed the camera", async () => {
    const capture = new TestCapture();
    capture.pendingOpen = new Deferred();
    const { camera, media } = publication({ capture });

    const starting = camera.start();
    await settle();
    camera.close();
    capture.pendingOpen.resolve();
    await starting;

    expect(media.producers).toHaveLength(0);
    expect(useDirectCall.getState().cameraStatus).toBe("off");
  });

  it("reports a failed publication and turns the captured camera off again", async () => {
    const media = new TestMediaGraph();
    media.produceFailure = new Error("transport is gone");
    const { camera, signaling, preview } = publication({ media });

    await expect(camera.start()).rejects.toThrow("transport is gone");

    expect(useDirectCall.getState()).toMatchObject({
      cameraStatus: "error",
      cameraError: "transport is gone",
    });
    expect(preview.shown.at(-2)?.readyState).toBe("ended");
    expect(preview.current).toBeNull();
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toEqual([]);
  });

  it("withdraws a producer the server already has when adapting it fails", async () => {
    const media = new TestMediaGraph();
    const adaptation = new CameraNetworkAdaptation(call);
    await adaptation.setQuality("good");
    const failingProducer = new Deferred<void>();
    media.encodingGate = failingProducer;
    const { camera, signaling } = publication({ media, adaptation });

    const starting = camera.start();
    await settle();
    failingProducer.reject(new Error("encoding refused"));

    await expect(starting).rejects.toThrow("encoding refused");
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toEqual([
      { mediaRoomId: roomId, producerId: media.producers[0]?.id },
    ]);
    expect(useDirectCall.getState().cameraStatus).toBe("error");
  });

  it("owes the server a stop made offline and pays it only into the same room", async () => {
    const signaling = new TestSignaling();
    const { camera, release, media } = publication({ signaling });
    await camera.start();

    signaling.connected = false;
    await camera.stop();
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toEqual([]);

    signaling.connected = true;
    await release.flush();
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toEqual([
      { mediaRoomId: roomId, producerId: media.producers[0]?.id },
    ]);

    await camera.start();
    signaling.connected = false;
    await camera.stop();
    voice.joined("direct-call:another", "session-two", []);
    signaling.connected = true;
    await release.flush();
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toHaveLength(1);
  });

  it("shows why the server refused a stop", async () => {
    const signaling = new TestSignaling();
    const { camera } = publication({ signaling });
    await camera.start();
    signaling.failing.add(VoiceClientEvent.CameraStop);

    await expect(camera.stop()).rejects.toThrow("refused");

    expect(useDirectCall.getState()).toMatchObject({
      cameraStatus: "error",
      cameraError: `${VoiceClientEvent.CameraStop} refused`,
    });
  });

  it("stops publishing when the camera itself goes away", async () => {
    const { camera, media, signaling } = publication();
    await camera.start();

    (media.producers[0]?.track as TestTrack).endByDevice();
    await settle();

    expect(media.producers[0]?.closed).toBe(true);
    expect(signaling.sent(VoiceClientEvent.CameraStop)).toHaveLength(1);
    expect(useDirectCall.getState().cameraStatus).toBe("off");
  });

  it("frees a busy single-pipeline camera before opening the next one", async () => {
    const capture = new TestCapture(["front", "back"]);
    const { camera, media, preview } = publication({ capture });
    await camera.start();
    const producer = media.producers[0];
    const front = producer?.track;
    capture.failures.push(new DOMException("Could not start video source", "NotReadableError"));

    await camera.switchCamera();

    expect(capture.opened.slice(1)).toEqual([
      { deviceId: "back", constrained: true },
      { deviceId: "back", constrained: false },
    ]);
    expect(front?.readyState).toBe("ended");
    const back = producer?.replacedWith[0];
    expect(back?.getSettings().deviceId).toBe("back");
    expect(preview.current).toBe(back);
    expect(useDirectCall.getState().cameraStatus).toBe("on");

    // The old track's ended listener is gone: only the new camera ending stops the call camera.
    (front as TestTrack).endByDevice();
    await settle();
    expect(producer?.closed).toBe(false);
  });

  it("keeps the old camera on when the switch fails without touching it", async () => {
    const capture = new TestCapture(["front", "back"]);
    const { camera } = publication({ capture });
    await camera.start();
    capture.failures.push(new Error("back camera denied"));

    await expect(camera.switchCamera()).rejects.toThrow("back camera denied");

    expect(useDirectCall.getState()).toMatchObject({
      cameraStatus: "on",
      cameraError: "back camera denied",
    });
  });

  it("goes off on a server close but keeps the earlier error visible", async () => {
    const { camera, media } = publication();
    await camera.start();
    call.cameraFailed("earlier problem", "on");

    camera.closed(media.producers[0]?.id ?? "");

    expect(useDirectCall.getState()).toMatchObject({
      cameraStatus: "off",
      cameraError: "earlier problem",
    });
  });
});

describe("CameraNetworkAdaptation", () => {
  it("lets a newer poor report win over an older one still setting the bitrate", async () => {
    const adaptation = new CameraNetworkAdaptation(call);
    const producer = new TestProducer("camera-1", new TestTrack("front"));
    await adaptation.publish(producer);
    const slow = new Deferred<void>();
    producer.pendingEncoding = slow;

    const constrained = adaptation.setQuality("constrained");
    await adaptation.setQuality("poor");
    slow.resolve();
    await constrained;

    expect(producer.encodings.at(-1)).toEqual({ maxBitrate: 200_000 });
    expect(producer.paused).toBe(true);
    expect(useDirectCall.getState().cameraNetworkPaused).toBe(true);
  });

  it.each<[CallConnectionQuality, number]>([
    ["good", 500_000],
    ["constrained", 200_000],
    ["unknown", 200_000],
  ])("caps the bitrate for %s and resumes", async (quality, maxBitrate) => {
    const adaptation = new CameraNetworkAdaptation(call);
    const producer = new TestProducer("camera-1", new TestTrack("front"));
    producer.paused = true;
    await adaptation.publish(producer);

    await adaptation.setQuality(quality);

    expect(producer.encodings.at(-1)).toEqual({ maxBitrate });
    expect(producer.paused).toBe(false);
  });

  it("leaves a released producer alone", async () => {
    const adaptation = new CameraNetworkAdaptation(call);
    const producer = new TestProducer("camera-1", new TestTrack("front"));
    await adaptation.publish(producer);
    adaptation.release();

    await adaptation.setQuality("poor");

    expect(producer.paused).toBe(false);
  });
});

function receiver(media = new TestMediaGraph(), signaling = new TestSignaling()) {
  const view = new RecordingView();
  const remote = new RemoteCameraReceiver(signaling, voice, call, media, view, () => alice.id);
  return { remote, media, signaling, view };
}

describe("RemoteCameraReceiver", () => {
  it("shows the peer's camera once, however often its producer is announced", async () => {
    const { remote, media, signaling, view } = receiver();

    await Promise.all([remote.consume(bob.id, "bob-camera"), remote.consume(bob.id, "bob-camera")]);
    await remote.consume(bob.id, "bob-camera");

    expect(media.consumers).toHaveLength(1);
    expect(view.current).toBe(media.consumers[0]?.track);
    expect(useDirectCall.getState().remoteCameraOn).toBe(true);
    expect(signaling.sent(VoiceClientEvent.ResumeConsumer)).toEqual([
      { consumerId: media.consumers[0]?.id },
    ]);
  });

  it("ignores cameras outside the active call", async () => {
    const { remote, media } = receiver();

    await remote.consume(alice.id, "own-camera");
    await remote.consume("stranger-id", "stranger-camera");
    call.pending({ ...activeCall, status: "RINGING" });
    await remote.consume(bob.id, "bob-camera");

    expect(media.consumers).toHaveLength(0);
  });

  it("closes an older consumer that lost the race to a newer producer", async () => {
    const media = new TestMediaGraph();
    media.pendingConsumers.set("bob-camera-old", new Deferred());
    const { remote, view } = receiver(media);

    const older = remote.consume(bob.id, "bob-camera-old");
    await settle();
    await remote.consume(bob.id, "bob-camera-new");
    media.pendingConsumers.get("bob-camera-old")?.resolve();
    await older;

    const [newer, stale] = media.consumers;
    expect(newer?.producerId).toBe("bob-camera-new");
    expect(stale?.closed).toBe(true);
    expect(view.current).toBe(newer?.track);
  });

  it("takes the camera down again when the server will not resume it", async () => {
    const signaling = new TestSignaling();
    signaling.failing.add(VoiceClientEvent.ResumeConsumer);
    const { remote, media, view } = receiver(new TestMediaGraph(), signaling);

    await expect(remote.consume(bob.id, "bob-camera")).rejects.toThrow("refused");

    expect(media.consumers[0]?.closed).toBe(true);
    expect(view.current).toBeNull();
    expect(useDirectCall.getState().remoteCameraOn).toBe(false);
  });

  it("closes only for its own producer", async () => {
    const { remote, media } = receiver();
    await remote.consume(bob.id, "bob-camera");

    remote.closed("something-else");
    expect(media.consumers[0]?.closed).toBe(false);

    remote.closed("bob-camera");
    expect(media.consumers[0]?.closed).toBe(true);
    expect(useDirectCall.getState().remoteCameraOn).toBe(false);
  });
});

describe("CallCamera", () => {
  it("keeps receiving the peer while our own camera starts in the middle of it", async () => {
    // Regression: one generation counter used to cover both directions, so starting our
    // camera discarded the peer's consumer in flight and left its producer id marked as
    // pending — every later announcement of it was then ignored for the rest of the call.
    const media = new TestMediaGraph();
    media.pendingConsumers.set("bob-camera", new Deferred());
    const camera = new CallCamera(
      new TestSignaling(),
      voice,
      media,
      call,
      new TestCapture(),
      () => alice.id,
    );

    const receiving = camera.consume(bob.id, "bob-camera");
    await settle();
    await camera.start();
    media.pendingConsumers.get("bob-camera")?.resolve();
    await receiving;

    expect(media.consumers[0]?.closed).toBe(false);
    expect(useDirectCall.getState()).toMatchObject({ remoteCameraOn: true, cameraStatus: "on" });
  });

  it("routes a closed producer to whichever side owns it", async () => {
    const media = new TestMediaGraph();
    const camera = new CallCamera(
      new TestSignaling(),
      voice,
      media,
      call,
      new TestCapture(),
      () => alice.id,
    );
    await camera.start();
    await camera.consume(bob.id, "bob-camera");

    camera.closed("bob-camera");
    expect(useDirectCall.getState()).toMatchObject({ remoteCameraOn: false, cameraStatus: "on" });

    camera.closed(media.producers[0]?.id ?? "");
    expect(useDirectCall.getState().cameraStatus).toBe("off");
  });
});
