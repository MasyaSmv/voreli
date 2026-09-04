import type { VoiceParticipantView } from "@voreli/shared";
import { create } from "zustand";

export type VoiceConnectionState = "idle" | "joining" | "connected" | "reconnecting";

interface VoiceState {
  readonly channelId: string | null;
  readonly sessionId: string | null;
  readonly connection: VoiceConnectionState;
  readonly participants: readonly VoiceParticipantView[];
  readonly speakingUserIds: ReadonlySet<string>;
  readonly error: string | null;
  replace: (
    state: Partial<Omit<VoiceState, "replace" | "upsertParticipant" | "removeParticipant">>,
  ) => void;
  upsertParticipant: (participant: VoiceParticipantView) => void;
  removeParticipant: (userId: string) => void;
}

export const useVoice = create<VoiceState>((set) => ({
  channelId: null,
  sessionId: null,
  connection: "idle",
  participants: [],
  speakingUserIds: new Set(),
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
}));
