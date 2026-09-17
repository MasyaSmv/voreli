import { Injectable } from "@nestjs/common";
import type { DirectCall, User } from "@prisma/client";
import type { DirectCallView } from "@voreli/shared";

import { UserPresenter } from "../auth/user-presenter.js";

export type DirectCallWithUsers = DirectCall & { readonly caller: User; readonly callee: User };

@Injectable()
export class DirectCallPresenter {
  constructor(private readonly users: UserPresenter) {}

  toView(call: DirectCallWithUsers): DirectCallView {
    return {
      id: call.id,
      conversationId: call.conversationId,
      caller: this.users.toPublic(call.caller),
      callee: this.users.toPublic(call.callee),
      status: call.status,
      createdAt: call.createdAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      endedById: call.endedById,
    };
  }
}
