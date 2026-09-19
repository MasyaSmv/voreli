import type { ScreenShareView, VoiceParticipantView } from "@voreli/shared";
import { create } from "zustand";

export type VoiceConnectionState = "idle" | "joining" | "connected" | "reconnecting";

interface VoiceState {
  readonly channelId: string | null;
  readonly sessionId: string | null;
  readonly connection: VoiceConnectionState;
  readonly participants: readonly VoiceParticipantView[];
  readonly speakingUserIds: ReadonlySet<string>;
  readonly screenShares: readonly ScreenShareView[];
  readonly selectedScreenShareId: string | null;
  readonly screenAudioBlocked: boolean;
  readonly error: string | null;
  replace: (
    state: Partial<
      Omit<
        VoiceState,
        | "replace"
        | "upsertParticipant"
        | "removeParticipant"
        | "upsertScreenShare"
        | "removeScreenShare"
      >
    >,
  ) => void;
  upsertParticipant: (participant: VoiceParticipantView) => void;
  removeParticipant: (userId: string) => void;
  upsertScreenShare: (screenShare: ScreenShareView) => void;
  removeScreenShare: (screenStreamId: string) => void;
}

export const useVoice = create<VoiceState>((set) => ({
  channelId: null,
  sessionId: null,
  connection: "idle",
  participants: [],
  speakingUserIds: new Set(),
  screenShares: [],
  selectedScreenShareId: null,
  screenAudioBlocked: false,
  error: null,

  replace(state) {
    set(state);
  },

  upsertParticipant(participant) {
    set((state) => ({
      participants: state.participants.some((current) => current.userId === participant.userId)
        ? state.participants.map((current) =>
            current.userId === participant.userId ? participant : current,
          )
        : [...state.participants, participant],
    }));
  },

  removeParticipant(userId) {
    set((state) => ({
      participants: state.participants.filter((participant) => participant.userId !== userId),
      speakingUserIds: new Set(
        [...state.speakingUserIds].filter((speakingUserId) => speakingUserId !== userId),
      ),
    }));
  },

  upsertScreenShare(screenShare) {
    set((state) => ({
      screenShares: state.screenShares.some((current) => current.id === screenShare.id)
        ? state.screenShares.map((current) =>
            current.id === screenShare.id ? screenShare : current,
          )
        : [...state.screenShares, screenShare],
    }));
  },

  removeScreenShare(screenStreamId) {
    set((state) => ({
      screenShares: state.screenShares.filter((screenShare) => screenShare.id !== screenStreamId),
      selectedScreenShareId:
        state.selectedScreenShareId === screenStreamId ? null : state.selectedScreenShareId,
      screenAudioBlocked:
        state.selectedScreenShareId === screenStreamId ? false : state.screenAudioBlocked,
    }));
  },
}));
