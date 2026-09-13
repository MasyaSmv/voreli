import { Injectable } from "@nestjs/common";
import { callIdFromMediaRoom } from "@voreli/shared";

import { DirectCallStore } from "../calls/direct-call.store.js";
import { VoiceConnectForbiddenError } from "./errors/voice-room-errors.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";

@Injectable()
export class MediaRoomAccessService {
  constructor(
    private readonly channels: VoiceChannelAccessService,
    private readonly calls: DirectCallStore,
  ) {}

  async assertConnect(
    userId: string,
    authenticationSessionId: string,
    mediaRoomId: string,
  ): Promise<void> {
    if (callIdFromMediaRoom(mediaRoomId) === null) {
      await this.channels.assertConnect(userId, mediaRoomId);
      return;
    }

    const call = await this.calls.activeByMediaRoom(mediaRoomId);
    const allowed =
      call !== null &&
      ((call.callerId === userId && call.callerSessionId === authenticationSessionId) ||
        (call.calleeId === userId && call.answeredSessionId === authenticationSessionId));
    if (!allowed) {
      throw new VoiceConnectForbiddenError();
    }
  }

  async canSpeak(userId: string, mediaRoomId: string): Promise<boolean> {
    if (callIdFromMediaRoom(mediaRoomId) === null) {
      return this.channels.canSpeak(userId, mediaRoomId);
    }

    const call = await this.calls.activeByMediaRoom(mediaRoomId);
    return call !== null && (call.callerId === userId || call.calleeId === userId);
  }

  maxParticipants(mediaRoomId: string): number | undefined {
    return callIdFromMediaRoom(mediaRoomId) === null ? undefined : 2;
  }
}
