import { Injectable, Logger } from "@nestjs/common";
import {
  VoiceServerEvent,
  type VoiceParticipantView,
  type VoiceProducerEvent,
  type VoiceSpeakingEvent,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

export function voiceRoomOf(channelId: string): string {
  return `voice:${channelId}`;
}

@Injectable()
export class VoiceBroadcaster {
  private readonly logger = new Logger(VoiceBroadcaster.name);
  private server?: Namespace;

  attach(server: Namespace): void {
    this.server = server;
  }

  participantJoined(channelId: string, participant: VoiceParticipantView): void {
    this.emit(channelId, VoiceServerEvent.ParticipantJoined, { participant });
  }

  participantUpdated(channelId: string, participant: VoiceParticipantView): void {
    this.emit(channelId, VoiceServerEvent.ParticipantUpdated, { participant });
  }

  participantLeft(channelId: string, userId: string): void {
    this.emit(channelId, VoiceServerEvent.ParticipantLeft, { userId });
  }

  producerCreated(channelId: string, event: VoiceProducerEvent): void {
    this.emit(channelId, VoiceServerEvent.ProducerNew, event);
  }

  producerClosed(channelId: string, producerId: string): void {
    this.emit(channelId, VoiceServerEvent.ProducerClosed, { producerId });
  }

  speaking(channelId: string, event: VoiceSpeakingEvent): void {
    this.emit(channelId, VoiceServerEvent.Speaking, event);
  }

  private emit(channelId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.error({
        message: "Voice broadcast dropped: no namespace attached",
        event,
        channelId,
        operation: "broadcastVoiceEvent",
      });
      return;
    }

    this.server.to(voiceRoomOf(channelId)).emit(event, payload);
  }
}
