import type { CallConnectionQuality, DirectCallView } from "@voreli/shared";
import { create } from "zustand";

export type CallCameraStatus = "off" | "starting" | "on" | "error";

/**
 * What the UI reads about the current direct call. Data only, on purpose: every write goes
 * through `DirectCallState` in features/direct-call, which is the one writer of this store.
 */
export interface DirectCallSnapshot {
  readonly call: DirectCallView | null;
  readonly mediaRoomId: string | null;
  readonly quality: CallConnectionQuality;
  readonly error: string | null;
  readonly cameraStatus: CallCameraStatus;
  readonly cameraError: string | null;
  readonly cameraSwitchAvailable: boolean;
  readonly cameraNetworkPaused: boolean;
  /** The peer's camera is being received; the stream itself lives with the video binding. */
  readonly remoteCameraOn: boolean;
  readonly reconnectingUserId: string | null;
  readonly historyRevision: number;
  readonly lastEndedConversationId: string | null;
}

/** Everything a finished or abandoned call resets; history bookkeeping survives it. */
export const directCallIdle = {
  call: null,
  mediaRoomId: null,
  quality: "unknown",
  error: null,
  cameraStatus: "off",
  cameraError: null,
  cameraSwitchAvailable: false,
  cameraNetworkPaused: false,
  remoteCameraOn: false,
  reconnectingUserId: null,
} as const satisfies Omit<DirectCallSnapshot, "historyRevision" | "lastEndedConversationId">;

export const useDirectCall = create<DirectCallSnapshot>(() => ({
  ...directCallIdle,
  historyRevision: 0,
  lastEndedConversationId: null,
}));
