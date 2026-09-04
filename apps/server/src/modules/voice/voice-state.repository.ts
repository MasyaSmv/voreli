export const VOICE_STATE_REPOSITORY = Symbol("VOICE_STATE_REPOSITORY");

export interface VoiceParticipantState {
  readonly userId: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly socketId: string | null;
  readonly selfMuted: boolean;
  readonly selfDeafened: boolean;
  readonly moderatorMuted: boolean;
  readonly joinedAt: string;
  readonly disconnectedAt: string | null;
}

export interface VoiceRoomMeta {
  readonly instanceId: string;
  readonly routerId: string;
  readonly createdAt: string;
}

export interface VoiceJoinInput {
  readonly channelId: string;
  readonly userId: string;
  readonly socketId: string;
  readonly newSessionId: string;
  readonly resumeSessionId?: string;
  readonly now: string;
}

export type VoiceJoinResult =
  | {
      readonly kind: "joined";
      readonly participant: VoiceParticipantState;
      readonly displaced: VoiceParticipantState | null;
    }
  | { readonly kind: "resumed"; readonly participant: VoiceParticipantState }
  | { readonly kind: "other-channel"; readonly channelId: string }
  | { readonly kind: "evicting" };

export interface VoiceStateRepository {
  claimRoom(channelId: string, meta: VoiceRoomMeta): Promise<string>;
  join(input: VoiceJoinInput): Promise<VoiceJoinResult>;
  participant(channelId: string, userId: string): Promise<VoiceParticipantState | null>;
  participants(channelId: string): Promise<readonly VoiceParticipantState[]>;
  disconnect(
    channelId: string,
    userId: string,
    socketId: string,
    disconnectedAt: string,
  ): Promise<VoiceParticipantState | null>;
  beginEviction(channelId: string, userId: string, generation: number): Promise<boolean>;
  finishEviction(channelId: string, userId: string, generation: number): Promise<boolean>;
  leave(channelId: string, userId: string, sessionId: string, generation: number): Promise<boolean>;
  touch(userId: string): Promise<boolean>;
  updateSelfState(
    channelId: string,
    userId: string,
    sessionId: string,
    selfMuted: boolean,
    selfDeafened: boolean,
  ): Promise<VoiceParticipantState | null>;
  removeRoomsOwnedBy(instanceId: string): Promise<number>;
}
