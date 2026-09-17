import { RELATIONSHIP_ROUTES, type MessagePage } from "@voreli/shared";

import { apiFetch } from "../../shared/api/http";

export function fetchDirectHistory(conversationId: string, before?: string): Promise<MessagePage> {
  const query = before === undefined ? "" : `?before=${encodeURIComponent(before)}`;
  return apiFetch(`${RELATIONSHIP_ROUTES.directConversationMessages(conversationId)}${query}`);
}
