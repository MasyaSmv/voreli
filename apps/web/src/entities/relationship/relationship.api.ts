import {
  type AcceptFriendRequestResponse,
  type ContactLookupResponse,
  type ContactSettingsView,
  type DirectConversationView,
  RELATIONSHIP_ROUTES,
  type RelationshipsView,
  type UpdateContactSettingsInput,
  type FriendRequestView,
} from "@voreli/shared";

import { apiFetch } from "../../shared/api/http";

export function lookupContact(username: string): Promise<ContactLookupResponse> {
  return apiFetch(`${RELATIONSHIP_ROUTES.lookup}?username=${encodeURIComponent(username)}`);
}

export function fetchContactSettings(): Promise<ContactSettingsView> {
  return apiFetch(RELATIONSHIP_ROUTES.contactSettings);
}

export function updateContactSettings(
  input: UpdateContactSettingsInput,
): Promise<ContactSettingsView> {
  return apiFetch(RELATIONSHIP_ROUTES.contactSettings, { method: "PATCH", body: input });
}

export function fetchRelationships(): Promise<RelationshipsView> {
  return apiFetch(RELATIONSHIP_ROUTES.relationships);
}

export function sendFriendRequest(username: string): Promise<FriendRequestView> {
  return apiFetch(RELATIONSHIP_ROUTES.friendRequests, {
    method: "POST",
    body: { username },
  });
}

export function acceptFriendRequest(requestId: string): Promise<AcceptFriendRequestResponse> {
  return apiFetch(RELATIONSHIP_ROUTES.friendRequestAccept(requestId), { method: "POST" });
}

export function declineFriendRequest(requestId: string): Promise<void> {
  return apiFetch(RELATIONSHIP_ROUTES.friendRequestDecline(requestId), { method: "POST" });
}

export function cancelFriendRequest(requestId: string): Promise<void> {
  return apiFetch(RELATIONSHIP_ROUTES.friendRequest(requestId), { method: "DELETE" });
}

export function unfriendContact(username: string): Promise<void> {
  return apiFetch(RELATIONSHIP_ROUTES.friend(username), { method: "DELETE" });
}

export function createDirectConversation(username: string): Promise<DirectConversationView> {
  return apiFetch(RELATIONSHIP_ROUTES.directConversations, {
    method: "POST",
    body: { username },
  });
}

export function fetchDirectConversations(): Promise<readonly DirectConversationView[]> {
  return apiFetch(RELATIONSHIP_ROUTES.directConversations);
}

export function blockContact(username: string): Promise<void> {
  return apiFetch(RELATIONSHIP_ROUTES.blocks, { method: "POST", body: { username } });
}

export function unblockContact(username: string): Promise<void> {
  return apiFetch(RELATIONSHIP_ROUTES.block(username), { method: "DELETE" });
}
