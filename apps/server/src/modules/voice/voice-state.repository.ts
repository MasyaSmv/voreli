export const VOICE_STATE_REPOSITORY = Symbol("VOICE_STATE_REPOSITORY");

export interface VoiceParticipantState {
  readonly userId: string;
  readonly authenticationSessionId: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly socketId: string | null;
  readonly selfMuted: boolean;
  readonly selfDeafened: boolean;
  readonly moderatorMuted: boolean;
  readonly moderatorDeafened: boolean;
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
  readonly authenticationSessionId: string;
  readonly socketId: string;
  readonly newSessionId: string;
  readonly resumeSessionId?: string;
  readonly now: string;
  readonly maxParticipants?: number;
}

export type VoiceJoinResult =
  | {
      readonly kind: "joined";
      readonly participant: VoiceParticipantState;
      readonly displaced: VoiceParticipantState | null;
    }
  | { readonly kind: "resumed"; readonly participant: VoiceParticipantState }
  | { readonly kind: "other-channel"; readonly channelId: string }
  | { readonly kind: "full" }
  | { readonly kind: "evicting" };

export interface VoiceStateRepository {
  claimRoom(channelId: string, meta: VoiceRoomMeta): Promise<string>;
  channelOf(userId: string): Promise<string | null>;
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
    generation: number,
    state: VoiceSelfControlState,
  ): Promise<VoiceParticipantState | null>;
  /**
   * Writes the moderator half only if it still holds `expected`. The caller decided which
   * permission the change needs by looking at those two flags, so a value that moved in the
   * meantime means the decision was made about a state that no longer exists.
   */
  updateModeratorState(
    channelId: string,
    userId: string,
    sessionId: string,
    generation: number,
    expected: VoiceModeratorControlState,
    next: VoiceModeratorControlState,
  ): Promise<VoiceParticipantState | null>;
  removeRoomsOwnedBy(instanceId: string): Promise<number>;
}

/**
 * The two halves are written separately and never as one snapshot: a participant's own mute
 * and a moderator's mute are issued by different people, land on different instances and
 * must not be able to overwrite each other with a value each of them merely read earlier.
 */
export interface VoiceSelfControlState {
  readonly selfMuted: boolean;
  readonly selfDeafened: boolean;
}

export interface VoiceModeratorControlState {
  readonly moderatorMuted: boolean;
  readonly moderatorDeafened: boolean;
}
