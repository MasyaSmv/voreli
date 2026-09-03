import type { ServerSummary, ServerView, UnreadResponse } from "@voreli/shared";

import { apiFetch } from "../../shared/api/http";

export async function fetchMyServers(): Promise<readonly ServerSummary[]> {
  const response = await apiFetch<{ servers: readonly ServerSummary[] }>("/servers");

  return response.servers;
}

export async function fetchServer(serverId: string): Promise<ServerView> {
  return apiFetch<ServerView>(`/servers/${serverId}`);
}

export async function createServer(name: string): Promise<ServerSummary> {
  return apiFetch<ServerSummary>("/servers", { method: "POST", body: { name } });
}

export async function fetchUnread(serverId: string): Promise<UnreadResponse> {
  return apiFetch<UnreadResponse>(`/servers/${serverId}/unread`);
}
