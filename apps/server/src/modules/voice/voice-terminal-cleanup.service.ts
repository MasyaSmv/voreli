import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { callIdFromMediaRoom } from "@voreli/shared";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { DirectCallStore } from "../calls/direct-call.store.js";

@Injectable()
export class VoiceTerminalCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceTerminalCleanupService.name);
  private readonly unsubscribers: (() => void)[] = [];

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly rooms: VoiceRoomService,
    private readonly calls: DirectCallStore,
  ) {}

  onModuleInit(): void {
    this.unsubscribers.push(
      this.events.subscribe("call.terminal", async ({ mediaRoomId }) => {
        await this.rooms.cleanupLocalRoom(mediaRoomId);
      }),
      this.events.subscribeShared("call.reconcile", async ({ activeMediaRoomIds }) => {
        for (const mediaRoomId of this.rooms.localRoomIds()) {
          if (callIdFromMediaRoom(mediaRoomId) === null) continue;
          if (!(await this.calls.activeByMediaRoom(mediaRoomId))) {
            this.logger.warn({
              message: "Reconciliation found media for a terminal call",
              mediaRoomId,
              operation: "reconcileDirectCallMedia",
            });
            await this.rooms.cleanupLocalRoom(mediaRoomId);
          }
        }
        for (const mediaRoomId of activeMediaRoomIds) {
          if (!(await this.rooms.hasParticipants(mediaRoomId))) {
            this.logger.warn({
              message: "Reconciliation found an active call without media participants",
              mediaRoomId,
              operation: "reconcileDirectCallMedia",
            });
            await this.events.publish("media.call.empty", { mediaRoomId });
          }
        }
      }),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }
}
