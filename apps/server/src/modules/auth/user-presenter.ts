import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { PublicUser } from "@voreli/shared";

/**
 * The single place a User row becomes something a client may see.
 *
 * Existing as a class rather than a helper inside the controller is the point: the password
 * hash can only leak through a path that skips this, and there is no such path.
 */
@Injectable()
export class UserPresenter {
  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
