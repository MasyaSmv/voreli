import { Injectable } from "@nestjs/common";

import { ScreenShareLifecycleService } from "./screen-share-lifecycle.service.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { VoiceSignalingService } from "./voice-signaling.service.js";
import { VoiceSocketMembershipService } from "./voice-socket-membership.service.js";

/** Applies the current channel permissions to one participant already present in voice. */
@Injectable()
export class VoicePermissionEnforcementService {
  constructor(
    private readonly access: VoiceChannelAccessService,
    private readonly rooms: VoiceRoomService,
    private readonly signaling: VoiceSignalingService,
    private readonly membership: VoiceSocketMembershipService,
    private readonly screenShares: ScreenShareLifecycleService,
  ) {}

  async enforce(userId: string, channelId: string): Promise<void> {
    if (!(await this.access.canConnect(userId, channelId))) {
      await this.membership.evictUser(userId, channelId);
      await this.rooms.leaveUser(userId);
      return;
    }

    if (!(await this.access.canSpeak(userId, channelId))) {
      await this.signaling.closeProducersForUser(userId);
    }
    if (!(await this.access.canShareScreen(userId, channelId))) {
      await this.screenShares.stopForUser(userId, channelId);
    }
  }
}
