import { CHAT_ROUTES, type MessagePage } from "@voreli/shared";

import { apiFetch } from "../../shared/api/http";

export async function fetchHistory(channelId: string, before?: string): Promise<MessagePage> {
  const query = before === undefined ? "" : `?before=${encodeURIComponent(before)}`;

  return apiFetch<MessagePage>(`${CHAT_ROUTES.messages(channelId)}${query}`);
}
