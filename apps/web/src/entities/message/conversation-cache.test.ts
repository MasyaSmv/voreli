import { QueryClient } from "@tanstack/react-query";
import type { MessageView, ReactionUpdatedEvent } from "@voreli/shared";
import { describe, expect, it } from "vitest";
import { ConversationCache } from "./conversation-cache";

function message(id: string): MessageView {
  return {
    id,
    channelId: "channel",
    directConversationId: null,
    author: { id: "me", username: "me", displayName: "Me", avatarUrl: null },
    body: { kind: "text", text: "hello" },
    replyToId: null,
    reply: null,
    attachments: [],
    reactions: [],
    deletedAt: null,
    createdAt: new Date(0).toISOString(),
    editedAt: null,
    clientNonce: null,
  };
}
function cache() {
  return new ConversationCache(new QueryClient(), ["test"]);
}

describe("conversation cache", () => {
  it("reconciles an optimistic nonce and keeps other authors' identical nonces", () => {
    const state = cache();
    state.insert({ ...message("optimistic"), clientNonce: "same" });
    state.insert({
      ...message("other"),
      author: { ...message("other").author, id: "other" },
      clientNonce: "same",
    });
    state.insert({ ...message("stored"), clientNonce: "same" });
    expect(state.page()?.messages.map((item) => item.id)).toEqual(["stored", "other"]);
  });
  it("rolls back only an unconfirmed optimistic message", () => {
    const state = cache();
    state.optimistic({ ...message("pending:nonce"), clientNonce: "nonce" });
    state.discardPending("nonce");
    expect(state.page()?.messages).toEqual([]);
    state.optimistic({ ...message("pending:nonce"), clientNonce: "nonce" });
    state.insert({ ...message("stored"), clientNonce: "nonce" });
    state.discardPending("nonce");
    expect(state.page()?.messages.map((item) => item.id)).toEqual(["stored"]);
  });
  it("keeps tombstones and updates every visible reply without exposing deleted content", () => {
    const state = cache();
    state.insert(message("target"));
    state.insert({
      ...message("reply"),
      reply: {
        id: "target",
        author: message("target").author,
        textPreview: "hello",
        deleted: false,
      },
    });
    state.remove("target");
    expect(state.page()?.messages[0]).toMatchObject({
      body: { kind: "text", text: "" },
      attachments: [],
      reactions: [],
      deletedAt: expect.any(String),
    });
    expect(state.page()?.messages[1]?.reply).toMatchObject({ deleted: true, textPreview: "" });
  });
  it("rolls back an optimistic reaction and preserves own flag on another user's event", () => {
    const state = cache();
    state.insert(message("target"));
    const event: ReactionUpdatedEvent = {
      channelId: "channel",
      messageId: "target",
      emoji: "👍",
      count: 1,
      changedByUserId: "me",
      added: true,
    };
    state.reaction(event, "me");
    expect(state.page()?.messages[0]?.reactions[0]?.reactedByCurrentUser).toBe(true);
    state.reaction({ ...event, count: 2, changedByUserId: "other" }, "me");
    expect(state.page()?.messages[0]?.reactions[0]).toMatchObject({
      count: 2,
      reactedByCurrentUser: true,
    });
    state.reaction({ ...event, count: 1, added: false }, "me");
    expect(state.page()?.messages[0]?.reactions[0]).toMatchObject({
      count: 1,
      reactedByCurrentUser: false,
    });
    state.remove("target");
    state.reaction(event, "me");
    expect(state.page()?.messages[0]?.reactions).toEqual([]);
  });
  it("preserves own reaction on message edits and limits live previews by graphemes", () => {
    const state = cache();
    state.insert({
      ...message("target"),
      reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: true }],
    });
    state.insert({
      ...message("reply"),
      reply: { id: "target", author: null, textPreview: "hello", deleted: false },
    });
    state.update({
      ...message("target"),
      body: { kind: "text", text: "👩‍👩‍👧‍👦".repeat(121) },
      reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false }],
    });
    expect(state.page()?.messages[0]?.reactions[0]?.reactedByCurrentUser).toBe(true);
    expect(state.page()?.messages[1]?.reply?.textPreview).toBe("👩‍👩‍👧‍👦".repeat(120));
  });
});
