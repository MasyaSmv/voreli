import type { MessageView } from "../chat/chat.contract.js";

export const ContactAudience = {
  Everyone: "EVERYONE",
  Friends: "FRIENDS",
  Nobody: "NOBODY",
} as const;

export type ContactAudience = (typeof ContactAudience)[keyof typeof ContactAudience];

export interface ContactCapabilities {
  readonly canMessage: boolean;
  readonly canCall: boolean;
  readonly canFriendRequest: boolean;
}

/** Safe public profile returned only by an exact @username lookup. */
export interface ContactProfile {
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly capabilities: ContactCapabilities;
}

export interface ContactLookupResponse {
  readonly user: ContactProfile | null;
}

export interface ContactSettingsView {
  readonly directMessageAudience: ContactAudience;
  readonly directCallAudience: ContactAudience;
  readonly friendRequestAudience: ContactAudience;
}

export interface UpdateContactSettingsInput {
  readonly directMessageAudience?: ContactAudience;
  readonly directCallAudience?: ContactAudience;
  readonly friendRequestAudience?: ContactAudience;
}

export interface FriendView {
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly friendsSince: string;
  readonly capabilities: ContactCapabilities;
}

export interface FriendRequestView {
  readonly id: string;
  readonly user: ContactProfile;
  readonly createdAt: string;
}

export interface RelationshipsView {
  readonly friends: readonly FriendView[];
  readonly incoming: readonly FriendRequestView[];
  readonly outgoing: readonly FriendRequestView[];
  readonly blocked: readonly ContactProfile[];
}

export interface AcceptFriendRequestResponse {
  readonly friend: FriendView;
  readonly conversation: DirectConversationView;
}

export interface DirectConversationView {
  readonly id: string;
  readonly participant: ContactProfile;
  readonly createdAt: string;
  readonly unreadCount: number;
  readonly lastMessage: MessageView | null;
}

export const RELATIONSHIP_ROUTES = {
  lookup: "/users/lookup",
  contactSettings: "/users/me/contact-settings",
  relationships: "/relationships",
  friendRequests: "/friend-requests",
  friendRequestAccept: (requestId: string) => `/friend-requests/${requestId}/accept`,
  friendRequestDecline: (requestId: string) => `/friend-requests/${requestId}/decline`,
  friendRequest: (requestId: string) => `/friend-requests/${requestId}`,
  friend: (username: string) => `/friends/${encodeURIComponent(username)}`,
  blocks: "/blocks",
  block: (username: string) => `/blocks/${encodeURIComponent(username)}`,
  directConversations: "/direct-conversations",
  directConversationMessages: (conversationId: string) =>
    `/direct-conversations/${conversationId}/messages`,
  directConversationRead: (conversationId: string) =>
    `/direct-conversations/${conversationId}/read`,
} as const;
