import type { CallConnectionQuality, DirectCallView } from "@voreli/shared";
import { create } from "zustand";

interface DirectCallState {
  readonly call: DirectCallView | null;
  readonly mediaRoomId: string | null;
  readonly quality: CallConnectionQuality;
  readonly error: string | null;
  readonly reconnectingUserId: string | null;
  readonly historyRevision: number;
  readonly lastEndedConversationId: string | null;
  replace(state: Partial<Omit<DirectCallState, "replace" | "reset" | "complete">>): void;
  reset(): void;
  complete(conversationId: string): void;
}

const initial = {
  call: null,
  mediaRoomId: null,
  quality: "unknown" as const,
  error: null,
  reconnectingUserId: null,
};

export const useDirectCall = create<DirectCallState>((set) => ({
  ...initial,
  historyRevision: 0,
  lastEndedConversationId: null,
  replace: (state) => set(state),
  reset: () =>
    set((state) => ({
      ...initial,
      historyRevision: state.historyRevision,
      lastEndedConversationId: state.lastEndedConversationId,
    })),
  complete: (conversationId) =>
    set((state) => ({
      ...initial,
      historyRevision: state.historyRevision + 1,
      lastEndedConversationId: conversationId,
    })),
}));
