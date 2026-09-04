import type { types } from "mediasoup-client";

export const VOICE_NAMESPACE = "/voice";

export const VoiceClientEvent = {
  Join: "voice:join",
  Leave: "voice:leave",
  CreateTransport: "transport:create",
  ConnectTransport: "transport:connect",
  RestartIce: "transport:restartIce",
  CreateProducer: "producer:create",
  CreateConsumer: "consumer:create",
  ResumeConsumer: "consumer:resume",
  SetSelfState: "voice:self-state",
  RefreshAuth: "auth:refresh",
} as const;

export const VoiceServerEvent = {
  ParticipantJoined: "voice:participant-joined",
  ParticipantLeft: "voice:participant-left",
  ParticipantUpdated: "voice:participant-updated",
  ProducerNew: "voice:producer-new",
  ProducerClosed: "voice:producer-closed",
  Speaking: "voice:speaking",
  Error: "voice:error",
} as const;

export type TransportDirection = "send" | "recv";

export interface VoiceProducerView {
  readonly producerId: string;
  readonly kind: types.MediaKind;
}

export interface VoiceParticipantView {
  readonly userId: string;
  readonly selfMuted: boolean;
  readonly selfDeafened: boolean;
  readonly producers: readonly VoiceProducerView[];
}

export interface VoiceJoinPayload {
  readonly channelId: string;
  readonly sessionId?: string;
}

export interface VoiceJoinResponse {
  readonly sessionId: string;
  readonly resumed: boolean;
  readonly rtpCapabilities: types.RtpCapabilities;
  readonly participants: readonly VoiceParticipantView[];
}

export interface CreateTransportPayload {
  readonly direction: TransportDirection;
}

export interface CreateTransportResponse {
  readonly id: string;
  readonly iceParameters: types.IceParameters;
  readonly iceCandidates: readonly types.IceCandidate[];
  readonly dtlsParameters: types.DtlsParameters;
}

export interface ConnectTransportPayload {
  readonly transportId: string;
  readonly dtlsParameters: types.DtlsParameters;
}

export interface RestartIcePayload {
  readonly transportId: string;
}

export interface RestartIceResponse {
  readonly iceParameters: types.IceParameters;
}

export interface CreateProducerPayload {
  readonly transportId: string;
  readonly kind: types.MediaKind;
  readonly rtpParameters: types.RtpParameters;
}

export interface CreateProducerResponse {
  readonly producerId: string;
}

export interface CreateConsumerPayload {
  readonly transportId: string;
  readonly producerId: string;
  readonly rtpCapabilities: types.RtpCapabilities;
}

export interface CreateConsumerResponse {
  readonly consumerId: string;
  readonly producerId: string;
  readonly kind: types.MediaKind;
  readonly rtpParameters: types.RtpParameters;
}

export interface ResumeConsumerPayload {
  readonly consumerId: string;
}

export interface SetVoiceSelfStatePayload {
  readonly selfMuted: boolean;
  readonly selfDeafened: boolean;
}

export interface VoiceParticipantJoinedEvent {
  readonly participant: VoiceParticipantView;
}

export interface VoiceParticipantLeftEvent {
  readonly userId: string;
}

export interface VoiceParticipantUpdatedEvent {
  readonly participant: VoiceParticipantView;
}

export interface VoiceProducerEvent extends VoiceProducerView {
  readonly userId: string;
}

export interface VoiceProducerClosedEvent {
  readonly producerId: string;
}

export interface VoiceSpeakingEvent {
  readonly speaking: readonly { readonly userId: string; readonly level: number }[];
}
