import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEventMap,
} from "../../common/events/domain-event-bus.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { VoiceSignalingService } from "./voice-signaling.service.js";
import { VoiceSocketMembershipService } from "./voice-socket-membership.service.js";
import { VOICE_STATE_REPOSITORY, type VoiceStateRepository } from "./voice-state.repository.js";

@Injectable()
export class VoicePermissionRevalidationService implements OnModuleInit, OnModuleDestroy {
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly prisma: PrismaService,
    private readonly access: VoiceChannelAccessService,
    private readonly rooms: VoiceRoomService,
    private readonly signaling: VoiceSignalingService,
    private readonly membership: VoiceSocketMembershipService,
  ) {}

  onModuleInit(): void {
    this.unsubscribers.push(
      this.events.subscribe("member.roles.changed", (event) => this.recheckMember(event)),
      this.events.subscribe("member.removed", (event) => this.recheckMember(event)),
      this.events.subscribe("channel.overrides.changed", (event) => this.recheckChannel(event)),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  private async recheckMember(
    event: DomainEventMap["member.roles.changed"] | DomainEventMap["member.removed"],
  ): Promise<void> {
    const channelId = await this.state.channelOf(event.userId);
    if (!channelId) return;
    const channel = await this.prisma.db.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (channel?.serverId === event.serverId) await this.recheckUser(event.userId, channelId);
  }

  private async recheckChannel(event: DomainEventMap["channel.overrides.changed"]): Promise<void> {
    const participants = await this.state.participants(event.channelId);
    await Promise.all(
      participants.map((participant) => this.recheckUser(participant.userId, event.channelId)),
    );
  }

  private async recheckUser(userId: string, channelId: string): Promise<void> {
    if (!(await this.access.canConnect(userId, channelId))) {
      await this.membership.evictUser(userId, channelId);
      await this.rooms.leaveUser(userId);
      return;
    }

    if (!(await this.access.canSpeak(userId, channelId))) {
      await this.signaling.closeProducersForUser(userId);
    }
  }
}
