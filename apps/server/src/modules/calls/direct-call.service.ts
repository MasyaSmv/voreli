import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  CALL_RING_TIMEOUT_MS,
  CALL_RECONNECT_GRACE_MS,
  callIdFromMediaRoom,
  callMediaRoomId,
  type AcceptCallResponse,
  type CallConnectionQualityEvent,
  type DirectCallView,
  type StartCallPayload,
  type SyncCallResponse,
} from "@voreli/shared";
import { ConfigService } from "@nestjs/config";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { ContactPolicyService } from "../relationships/contact-policy.service.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { ContactActionNotAllowedError } from "../relationships/errors/relationship-errors.js";
import type { EnvironmentVariables } from "../../config/env.validation.js";
import { CALL_DEADLINE_SCHEDULER, type CallDeadlineScheduler } from "./call-deadline.scheduler.js";
import { DirectCallNotifier } from "./direct-call-notifier.js";
import { DirectCallStore } from "./direct-call.store.js";
import type { DirectCallWithUsers } from "./direct-call.presenter.js";
import { DirectCallNotFoundError } from "./errors/direct-call-errors.js";

@Injectable()
export class DirectCallService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DirectCallService.name);
  private unsubscribeDeadline?: () => void;
  private unsubscribeMediaLeft?: () => void;
  private readonly unsubscribePolicy: (() => void)[] = [];
  private readonly active = new Map<string, DirectCallWithUsers>();
  private reconcileTimer?: NodeJS.Timeout;
  private reconciling = false;

  constructor(
    private readonly store: DirectCallStore,
    private readonly conversations: DirectConversationService,
    private readonly policy: ContactPolicyService,
    private readonly notifier: DirectCallNotifier,
    @Inject(CALL_DEADLINE_SCHEDULER) private readonly deadlines: CallDeadlineScheduler,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribeDeadline = this.deadlines.onExpired(async (callId) => {
      try {
        await this.timeout(callId);
      } catch (error: unknown) {
        this.logger.error({
          message: "Failed to expire ringing call",
          error,
          callId,
          operation: "expireDirectCall",
        });
      }
    });
    this.unsubscribeMediaLeft = this.events.subscribe("media.participant.left", async (event) => {
      const callId = callIdFromMediaRoom(event.mediaRoomId);
      if (!callId) return;
      const call = await this.store.findById(callId);
      if (!call || call.status !== "ACTIVE") return;
      try {
        await this.finish(callId, event.userId, "ACTIVE", "ENDED");
      } catch (error: unknown) {
        this.logger.warn({
          message: "Call was already completed while handling media departure",
          error,
          callId,
          userId: event.userId,
          operation: "finishCallAfterMediaDeparture",
        });
      }
    });
    this.unsubscribePolicy.push(
      this.events.subscribe("media.participant.reconnecting", async (event) => {
        const call = await this.store.activeByMediaRoom(event.mediaRoomId);
        if (call) {
          this.notifier.reconnecting(call, {
            callId: call.id,
            userId: event.userId,
            reconnecting: event.reconnecting,
          });
        }
      }),
      this.events.subscribe("relationship.changed", async (event) => {
        await this.revalidateCalls([event.userId, event.targetUserId], event.userId);
      }),
      this.events.subscribe("contact.policy.changed", async (event) => {
        await this.revalidateCalls([event.userId], event.userId);
      }),
      this.events.subscribe("session.revoked", async (event) => {
        const call = await this.store.activeForMediaSession(event.sessionId);
        if (call) await this.finish(call.id, event.userId, "ACTIVE", "ENDED");
      }),
      this.events.subscribe("media.call.empty", async (event) => {
        const callId = callIdFromMediaRoom(event.mediaRoomId);
        if (!callId) return;
        const call = this.active.get(callId) ?? (await this.store.byId(callId));
        if (call.status === "ACTIVE") {
          this.logger.warn({
            message: "Reconciliation is ending an active call without media participants",
            callId,
            operation: "reconcileDirectCalls",
          });
          await this.finish(call.id, call.callerId, "ACTIVE", "ENDED");
        }
      }),
    );

    for (const call of await this.store.activeCalls()) this.active.set(call.id, call);
    for (const call of await this.store.ringingCalls()) {
      const elapsed = Date.now() - call.createdAt.getTime();
      this.deadlines.schedule(call.id, Math.max(0, CALL_RING_TIMEOUT_MS - elapsed));
    }
    const intervalMs = this.config.get("CALL_RECONCILE_INTERVAL_MS", { infer: true });
    this.reconcileTimer = setInterval(() => void this.reconcileNow(), intervalMs);
    this.reconcileTimer.unref();
  }

  onModuleDestroy(): void {
    this.unsubscribeDeadline?.();
    this.unsubscribeMediaLeft?.();
    for (const unsubscribe of this.unsubscribePolicy) unsubscribe();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  async start(
    callerId: string,
    callerSessionId: string,
    payload: StartCallPayload,
  ): Promise<DirectCallView> {
    const conversation = await this.conversations.participant(payload.conversationId, callerId);
    const callee = this.conversations.otherUser(conversation, callerId);
    await this.policy.assertAllowed(callerId, callee.id, "call");

    const result = await this.store.start({
      conversationId: conversation.id,
      callerId,
      calleeId: callee.id,
      callerSessionId,
      clientNonce: payload.clientNonce,
    });
    if (result.created) {
      this.deadlines.schedule(result.call.id, CALL_RING_TIMEOUT_MS);
      return this.notifier.started(result.call);
    }
    return this.notifier.view(result.call);
  }

  async accept(callId: string, calleeId: string, sessionId: string): Promise<AcceptCallResponse> {
    const stored = await this.store.accept(callId, calleeId, sessionId);
    this.deadlines.cancel(callId);
    this.active.set(callId, stored);
    const mediaRoomId = callMediaRoomId(callId);
    const call = this.notifier.answered(stored, sessionId, mediaRoomId);
    return { call, mediaRoomId };
  }

  async decline(callId: string, userId: string): Promise<DirectCallView> {
    const current = await this.store.visible(callId, userId);
    if (current.calleeId !== userId) throw new DirectCallNotFoundError(callId);
    return this.finish(callId, userId, "RINGING", "DECLINED");
  }

  async cancel(callId: string, userId: string): Promise<DirectCallView> {
    const current = await this.store.visible(callId, userId);
    if (current.callerId !== userId) throw new DirectCallNotFoundError(callId);
    return this.finish(callId, userId, "RINGING", "CANCELLED");
  }

  async hangup(callId: string, userId: string): Promise<DirectCallView> {
    return this.finish(callId, userId, "ACTIVE", "ENDED");
  }

  reportQuality(userId: string, sessionId: string, event: CallConnectionQualityEvent): void {
    const call = this.active.get(event.callId);
    if (!call) return;
    const senderIsCaller = call.callerId === userId && call.callerSessionId === sessionId;
    const senderIsCallee = call.calleeId === userId && call.answeredSessionId === sessionId;
    if (!senderIsCaller && !senderIsCallee) return;
    this.notifier.quality(senderIsCaller ? call.calleeId : call.callerId, event);
  }

  async sync(userId: string, sessionId: string): Promise<SyncCallResponse> {
    const call = await this.store.unfinishedForUser(userId);
    if (!call) return { call: null, mediaRoomId: null };
    if (call.status === "RINGING") {
      return { call: this.notifier.view(call), mediaRoomId: null };
    }
    this.active.set(call.id, call);
    const ownsMedia =
      (call.callerId === userId && call.callerSessionId === sessionId) ||
      (call.calleeId === userId && call.answeredSessionId === sessionId);
    return {
      call: ownsMedia ? this.notifier.view(call) : null,
      mediaRoomId: ownsMedia ? callMediaRoomId(call.id) : null,
    };
  }

  private async timeout(callId: string): Promise<void> {
    const ringing = await this.store.byId(callId);
    if (ringing.status !== "RINGING") return;
    await this.finish(callId, ringing.callerId, "RINGING", "MISSED");
  }

  private async finish(
    callId: string,
    actorUserId: string,
    from: "RINGING" | "ACTIVE",
    status: "DECLINED" | "CANCELLED" | "MISSED" | "ENDED",
  ): Promise<DirectCallView> {
    const result = await this.store.terminal(callId, actorUserId, from, status);
    this.deadlines.cancel(callId);
    this.active.delete(callId);
    if (result.historyMessage) {
      await this.events.publish("call.terminal", { mediaRoomId: callMediaRoomId(callId) });
    }
    return this.notifier.finished(result.call, result.historyMessage);
  }

  async reconcileNow(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const expiredBefore = new Date(Date.now() - CALL_RING_TIMEOUT_MS);
      for (const call of await this.store.expiredRinging(expiredBefore, 100)) {
        this.logger.warn({
          message: "Reconciliation found an expired ringing call",
          callId: call.id,
          operation: "reconcileDirectCalls",
        });
        await this.timeout(call.id);
      }

      const activeCalls = await this.store.activeCalls();
      this.active.clear();
      for (const call of activeCalls) this.active.set(call.id, call);
      const abandonedCandidates = activeCalls
        .filter(
          (call) =>
            call.answeredAt !== null &&
            call.answeredAt.getTime() <= Date.now() - CALL_RECONNECT_GRACE_MS,
        )
        .map((call) => callMediaRoomId(call.id));
      await this.events.publish("call.reconcile", { activeMediaRoomIds: abandonedCandidates });
    } catch (error: unknown) {
      this.logger.error({
        message: "Failed to reconcile direct calls",
        error,
        operation: "reconcileDirectCalls",
      });
    } finally {
      this.reconciling = false;
    }
  }

  private async revalidateCalls(userIds: readonly string[], actorUserId: string): Promise<void> {
    const calls = await this.store.unfinishedForUsers(userIds);
    for (const call of calls) {
      try {
        await this.policy.assertAllowed(call.callerId, call.calleeId, "call");
      } catch (error: unknown) {
        if (!(error instanceof ContactActionNotAllowedError)) throw error;
        this.logger.warn({
          message: "Call access revoked after contact policy change",
          error,
          errorCode: error.errorCode,
          callId: call.id,
          actorUserId,
          operation: "revalidateDirectCallPolicy",
        });
        await this.finish(
          call.id,
          actorUserId,
          call.status === "ACTIVE" ? "ACTIVE" : "RINGING",
          call.status === "ACTIVE" ? "ENDED" : "CANCELLED",
        );
      }
    }
  }
}
