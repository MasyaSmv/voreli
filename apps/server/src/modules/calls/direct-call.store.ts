import { Inject, Injectable } from "@nestjs/common";
import type { DirectCallStatus } from "@prisma/client";
import {
  CALL_EVENT_CONTENT_SCHEMA,
  callIdFromMediaRoom,
  type CallEventContentV1,
} from "@voreli/shared";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import type { MessageWithAuthor } from "../chat/message-presenter.js";
import {
  DirectCallAlreadyAnsweredError,
  DirectCallInvalidStateError,
  DirectCallNotFoundError,
  DirectCallUserBusyError,
} from "./errors/direct-call-errors.js";
import type { DirectCallWithUsers } from "./direct-call.presenter.js";

const callWithUsers = { caller: true, callee: true } as const;
const unfinishedStatuses: readonly DirectCallStatus[] = ["RINGING", "ACTIVE"];

export interface StartedCall {
  readonly call: DirectCallWithUsers;
  readonly created: boolean;
}

export interface TransitionedCall {
  readonly call: DirectCallWithUsers;
  readonly historyMessage: MessageWithAuthor | null;
}

@Injectable()
export class DirectCallStore {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(input: {
    conversationId: string;
    callerId: string;
    calleeId: string;
    callerSessionId: string;
    clientNonce: string;
  }): Promise<StartedCall> {
    const existing = await this.prisma.db.directCall.findUnique({
      where: {
        callerSessionId_clientNonce: {
          callerSessionId: input.callerSessionId,
          clientNonce: input.clientNonce,
        },
      },
      include: callWithUsers,
    });
    if (existing) return { call: existing, created: false };

    return this.prisma.runInTransaction(async () => {
      for (const userId of [input.callerId, input.calleeId].sort()) {
        await this.prisma.db
          .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      }

      const raced = await this.prisma.db.directCall.findUnique({
        where: {
          callerSessionId_clientNonce: {
            callerSessionId: input.callerSessionId,
            clientNonce: input.clientNonce,
          },
        },
        include: callWithUsers,
      });
      if (raced) return { call: raced, created: false };

      const busy = await this.prisma.db.directCall.findFirst({
        where: {
          status: { in: [...unfinishedStatuses] },
          OR: [
            { callerId: { in: [input.callerId, input.calleeId] } },
            { calleeId: { in: [input.callerId, input.calleeId] } },
          ],
        },
        select: { callerId: true, calleeId: true },
      });
      if (busy) {
        const busyUserId = [input.callerId, input.calleeId].find(
          (userId) => busy.callerId === userId || busy.calleeId === userId,
        );
        throw new DirectCallUserBusyError(busyUserId ?? input.calleeId);
      }

      const call = await this.prisma.db.directCall.create({
        data: {
          id: this.ids.generate(),
          ...input,
          status: "RINGING",
        },
        include: callWithUsers,
      });
      return { call, created: true };
    });
  }

  async accept(callId: string, calleeId: string, sessionId: string): Promise<DirectCallWithUsers> {
    return this.prisma.runInTransaction(async () => {
      const current = await this.visible(callId, calleeId);
      if (current.calleeId !== calleeId) throw new DirectCallNotFoundError(callId);
      if (current.status === "ACTIVE") {
        if (current.answeredSessionId === sessionId) return current;
        throw new DirectCallAlreadyAnsweredError(callId);
      }
      if (current.status !== "RINGING") {
        throw new DirectCallInvalidStateError(callId, current.status);
      }

      const now = this.clock.now();
      const changed = await this.prisma.db.directCall.updateMany({
        where: { id: callId, status: "RINGING" },
        data: { status: "ACTIVE", answeredAt: now, answeredSessionId: sessionId },
      });
      if (changed.count === 0) {
        const raced = await this.visible(callId, calleeId);
        if (raced.status === "ACTIVE" && raced.answeredSessionId === sessionId) return raced;
        if (raced.status === "ACTIVE") throw new DirectCallAlreadyAnsweredError(callId);
        throw new DirectCallInvalidStateError(callId, raced.status);
      }
      return this.prisma.db.directCall.findUniqueOrThrow({
        where: { id: callId },
        include: callWithUsers,
      });
    });
  }

  async terminal(
    callId: string,
    actorUserId: string,
    from: DirectCallStatus,
    status: Exclude<DirectCallStatus, "RINGING" | "ACTIVE">,
  ): Promise<TransitionedCall> {
    return this.prisma.runInTransaction(async () => {
      const current = await this.visible(callId, actorUserId);
      if (current.status !== from) {
        if (current.status === status) return { call: current, historyMessage: null };
        throw new DirectCallInvalidStateError(callId, current.status);
      }

      const endedAt = this.clock.now();
      const outcome = this.outcome(status);
      const durationSeconds =
        status === "ENDED" && current.answeredAt
          ? Math.max(0, Math.floor((endedAt.getTime() - current.answeredAt.getTime()) / 1_000))
          : null;
      const content: CallEventContentV1 = {
        callId,
        outcome,
        durationSeconds,
        actorUserId,
      };
      const historyMessageId = this.ids.generate();

      const changed = await this.prisma.db.directCall.updateMany({
        where: { id: callId, status: from },
        data: { status, endedAt, endedById: actorUserId },
      });
      if (changed.count === 0) {
        const raced = await this.visible(callId, actorUserId);
        return { call: raced, historyMessage: null };
      }

      const historyMessage = await this.prisma.db.message.create({
        data: {
          id: historyMessageId,
          directConversationId: current.conversationId,
          authorId: current.callerId,
          content: Buffer.from(JSON.stringify(content)),
          contentSchema: CALL_EVENT_CONTENT_SCHEMA,
        },
        include: { author: true },
      });
      await this.prisma.db.directCall.update({
        where: { id: callId },
        data: { historyMessageId },
      });
      const call = await this.prisma.db.directCall.findUniqueOrThrow({
        where: { id: callId },
        include: callWithUsers,
      });
      return { call, historyMessage };
    });
  }

  async visible(callId: string, userId: string): Promise<DirectCallWithUsers> {
    const call = await this.prisma.db.directCall.findFirst({
      where: { id: callId, OR: [{ callerId: userId }, { calleeId: userId }] },
      include: callWithUsers,
    });
    if (!call) throw new DirectCallNotFoundError(callId);
    return call;
  }

  async activeByMediaRoom(mediaRoomId: string): Promise<DirectCallWithUsers | null> {
    const callId = callIdFromMediaRoom(mediaRoomId);
    if (!callId) return null;
    return this.prisma.db.directCall.findFirst({
      where: { id: callId, status: "ACTIVE" },
      include: callWithUsers,
    });
  }

  async byId(callId: string): Promise<DirectCallWithUsers> {
    const call = await this.findById(callId);
    if (!call) throw new DirectCallNotFoundError(callId);
    return call;
  }

  findById(callId: string): Promise<DirectCallWithUsers | null> {
    return this.prisma.db.directCall.findUnique({
      where: { id: callId },
      include: callWithUsers,
    });
  }

  unfinishedForUsers(userIds: readonly string[]): Promise<readonly DirectCallWithUsers[]> {
    return this.prisma.db.directCall.findMany({
      where: {
        status: { in: [...unfinishedStatuses] },
        OR: [{ callerId: { in: [...userIds] } }, { calleeId: { in: [...userIds] } }],
      },
      include: callWithUsers,
    });
  }

  activeForMediaSession(sessionId: string): Promise<DirectCallWithUsers | null> {
    return this.prisma.db.directCall.findFirst({
      where: {
        status: "ACTIVE",
        OR: [{ callerSessionId: sessionId }, { answeredSessionId: sessionId }],
      },
      include: callWithUsers,
    });
  }

  ringingCalls(): Promise<readonly DirectCallWithUsers[]> {
    return this.prisma.db.directCall.findMany({
      where: { status: "RINGING" },
      include: callWithUsers,
    });
  }

  activeCalls(take = 100): Promise<readonly DirectCallWithUsers[]> {
    return this.prisma.db.directCall.findMany({
      where: { status: "ACTIVE" },
      include: callWithUsers,
      orderBy: [{ answeredAt: "asc" }, { id: "asc" }],
      take,
    });
  }

  unfinishedForUser(userId: string): Promise<DirectCallWithUsers | null> {
    return this.prisma.db.directCall.findFirst({
      where: {
        status: { in: [...unfinishedStatuses] },
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      include: callWithUsers,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  expiredRinging(before: Date, take: number): Promise<readonly DirectCallWithUsers[]> {
    return this.prisma.db.directCall.findMany({
      where: { status: "RINGING", createdAt: { lte: before } },
      include: callWithUsers,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
    });
  }

  private outcome(
    status: Exclude<DirectCallStatus, "RINGING" | "ACTIVE">,
  ): CallEventContentV1["outcome"] {
    if (status === "ENDED") return "completed";
    return status.toLowerCase() as CallEventContentV1["outcome"];
  }
}
