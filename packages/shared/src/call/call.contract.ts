import type { PublicUser } from "../auth/auth.contract.js";

export const CALL_NAMESPACE = "/call";

export const CallClientEvent = {
  Start: "call:start",
  Accept: "call:accept",
  Decline: "call:decline",
  Cancel: "call:cancel",
  Hangup: "call:hangup",
  ReportQuality: "call:quality",
  Sync: "call:sync",
  RefreshAuth: "auth:refresh",
} as const;

export const CallServerEvent = {
  Incoming: "call:incoming",
  Ringing: "call:ringing",
  Answered: "call:answered",
  Ended: "call:ended",
  ParticipantReconnecting: "call:participant-reconnecting",
  ConnectionQuality: "call:connection-quality",
} as const;

export type DirectCallStatus = "RINGING" | "ACTIVE" | "DECLINED" | "CANCELLED" | "MISSED" | "ENDED";

export interface DirectCallView {
  readonly id: string;
  readonly conversationId: string;
  readonly caller: PublicUser;
  readonly callee: PublicUser;
  readonly status: DirectCallStatus;
  readonly createdAt: string;
  readonly answeredAt: string | null;
  readonly endedAt: string | null;
  readonly endedById: string | null;
}

export interface StartCallPayload {
  readonly conversationId: string;
  readonly clientNonce: string;
}

export interface CallIdPayload {
  readonly callId: string;
}

export interface StartCallResponse {
  readonly call: DirectCallView;
}

export interface AcceptCallResponse extends StartCallResponse {
  readonly mediaRoomId: string;
}

export interface SyncCallResponse {
  readonly call: DirectCallView | null;
  readonly mediaRoomId: string | null;
}

export interface CallEvent {
  readonly call: DirectCallView;
}

export interface CallAnsweredEvent extends CallEvent {
  readonly answeredByCurrentDevice: boolean;
  readonly mediaRoomId: string | null;
}

export interface CallParticipantReconnectingEvent {
  readonly callId: string;
  readonly userId: string;
  readonly reconnecting: boolean;
}

export type CallConnectionQuality = "good" | "constrained" | "poor" | "unknown";

export interface CallConnectionQualityEvent {
  readonly callId: string;
  readonly quality: CallConnectionQuality;
}

export const CALL_RING_TIMEOUT_MS = 30_000;
export const CALL_RECONNECT_GRACE_MS = 20_000;
export const CALL_EVENT_CONTENT_SCHEMA = "system/call/v1";
const CALL_MEDIA_ROOM_PREFIX = "direct-call:";

export function callMediaRoomId(callId: string): string {
  return `${CALL_MEDIA_ROOM_PREFIX}${callId}`;
}

export function callIdFromMediaRoom(mediaRoomId: string): string | null {
  return mediaRoomId.startsWith(CALL_MEDIA_ROOM_PREFIX)
    ? mediaRoomId.slice(CALL_MEDIA_ROOM_PREFIX.length)
    : null;
}

export interface CallEventContentV1 {
  readonly callId: string;
  readonly outcome: "completed" | "missed" | "declined" | "cancelled";
  readonly durationSeconds: number | null;
  readonly actorUserId: string;
}

export function decodeCallEventContent(bytes: Uint8Array): CallEventContentV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  const outcome = value["outcome"];
  if (
    typeof value["callId"] !== "string" ||
    !["completed", "missed", "declined", "cancelled"].includes(String(outcome)) ||
    (value["durationSeconds"] !== null && typeof value["durationSeconds"] !== "number") ||
    typeof value["actorUserId"] !== "string"
  ) {
    return null;
  }
  return {
    callId: value["callId"],
    outcome: outcome as CallEventContentV1["outcome"],
    durationSeconds: value["durationSeconds"],
    actorUserId: value["actorUserId"],
  };
}
