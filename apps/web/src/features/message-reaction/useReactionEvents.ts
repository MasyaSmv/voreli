import { ConversationCache } from "../../entities/message/conversation-cache";
import { useQueryClient } from "@tanstack/react-query";
import { ServerEvent, type ReactionUpdatedEvent } from "@voreli/shared";
import { useEffect } from "react";
import { useSession } from "../../entities/session/session.store";
import { chatSocket } from "../../shared/api/socket";

export function useReactionEvents(channelId: string | null) {
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.user?.id);
  useEffect(() => {
    const socket = chatSocket();
    const onReaction = (event: ReactionUpdatedEvent) => {
      if (event.channelId !== channelId) return;
      new ConversationCache(queryClient, [
        "conversation-messages",
        userId,
        JSON.stringify({ channelId }),
      ]).reaction(event, userId);
    };
    socket.on(ServerEvent.ReactionUpdated, onReaction);
    return () => {
      socket.off(ServerEvent.ReactionUpdated, onReaction);
    };
  }, [channelId, queryClient, userId]);
}
