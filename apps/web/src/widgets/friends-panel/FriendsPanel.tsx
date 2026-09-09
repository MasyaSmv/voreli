import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ServerEvent, type DirectConversationView } from "@voreli/shared";
import { useCallback, useEffect, useState } from "react";

import {
  acceptFriendRequest,
  blockContact,
  cancelFriendRequest,
  createDirectConversation,
  declineFriendRequest,
  fetchDirectConversations,
  fetchRelationships,
  sendFriendRequest,
  unblockContact,
  unfriendContact,
} from "../../entities/relationship/relationship.api";
import { chatSocket } from "../../shared/api/socket";
import { ContactSearch } from "./ContactSearch";
import { RelationshipLists } from "./RelationshipLists";

export function FriendsPanel({
  onOpen,
}: {
  readonly onOpen: (conversation: DirectConversationView) => void;
}) {
  const queryClient = useQueryClient();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const relationships = useQuery({
    queryKey: ["relationships"],
    queryFn: fetchRelationships,
    refetchOnMount: "always",
  });
  const conversations = useQuery({
    queryKey: ["direct-conversations"],
    queryFn: fetchDirectConversations,
    refetchOnMount: "always",
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["relationships"] });
    void queryClient.invalidateQueries({ queryKey: ["direct-conversations"] });
  }, [queryClient]);
  const requestFriend = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      refresh();
      setSearchResetKey((value) => value + 1);
    },
  });
  const accept = useMutation({ mutationFn: acceptFriendRequest, onSuccess: refresh });
  const decline = useMutation({ mutationFn: declineFriendRequest, onSuccess: refresh });
  const cancel = useMutation({ mutationFn: cancelFriendRequest, onSuccess: refresh });
  const unfriend = useMutation({ mutationFn: unfriendContact, onSuccess: refresh });
  const open = useMutation({
    mutationFn: createDirectConversation,
    onSuccess: (value) => {
      refresh();
      onOpen(value);
    },
  });
  const block = useMutation({
    mutationFn: blockContact,
    onSuccess: () => {
      refresh();
      setSearchResetKey((value) => value + 1);
    },
  });
  const unblock = useMutation({ mutationFn: unblockContact, onSuccess: refresh });

  useEffect(() => {
    const socket = chatSocket();
    socket.on(ServerEvent.RelationshipChanged, refresh);
    return () => {
      socket.off(ServerEvent.RelationshipChanged, refresh);
    };
  }, [refresh]);

  return (
    <aside className="flex w-[19rem] shrink-0 flex-col border-r border-line bg-panel">
      <ContactSearch
        resetKey={searchResetKey}
        onMessage={(username) => open.mutate(username)}
        onFriend={(username) => requestFriend.mutate(username)}
        onBlock={(username) => block.mutate(username)}
      />
      <RelationshipLists
        relationships={relationships.data}
        conversations={conversations.data}
        onOpen={onOpen}
        onMessage={(username) => open.mutate(username)}
        onAccept={(requestId) => accept.mutate(requestId)}
        onDecline={(requestId) => decline.mutate(requestId)}
        onCancel={(requestId) => cancel.mutate(requestId)}
        onUnfriend={(username) => unfriend.mutate(username)}
        onUnblock={(username) => unblock.mutate(username)}
      />
    </aside>
  );
}
