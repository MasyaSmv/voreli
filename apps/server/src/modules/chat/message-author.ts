import type { Prisma } from "@prisma/client";

/**
 * The author columns a message view is allowed to carry.
 *
 * Selected rather than included: `include: { author: true }` loads the whole user row,
 * password hash and e-mail with it. The presenter maps fields explicitly, so nothing leaks
 * today — this keeps it that way when someone spreads the author into a view tomorrow.
 */
export const messageAuthorSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

export type MessageAuthor = Prisma.UserGetPayload<{ select: typeof messageAuthorSelect }>;
