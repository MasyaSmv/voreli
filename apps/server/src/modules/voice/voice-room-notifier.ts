import { Inject, Injectable } from "@nestjs/common";
import type { VoiceParticipantView } from "@voreli/shared";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";

@Injectable()
export class VoiceRoomNotifier {
  constructor(
    private readonly broadcaster: VoiceBroadcaster,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  joined(mediaRoomId: string, participant: VoiceParticipantView): void {
    this.broadcaster.participantJoined(mediaRoomId, participant);
  }

  updated(mediaRoomId: string, participant: VoiceParticipantView): void {
    this.broadcaster.participantUpdated(mediaRoomId, participant);
  }

  async left(mediaRoomId: string, userId: string): Promise<void> {
    this.broadcaster.participantLeft(mediaRoomId, userId);
    await this.events.publish("media.participant.left", { mediaRoomId, userId });
  }

  async reconnecting(mediaRoomId: string, userId: string, reconnecting: boolean): Promise<void> {
    await this.events.publish("media.participant.reconnecting", {
      mediaRoomId,
      userId,
      reconnecting,
    });
  }
}
