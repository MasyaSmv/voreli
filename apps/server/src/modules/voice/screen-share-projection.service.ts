import { Inject, Injectable } from "@nestjs/common";
import type { ScreenShareView } from "@voreli/shared";

import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VOICE_STATE_REPOSITORY, type VoiceStateRepository } from "./voice-state.repository.js";

@Injectable()
export class ScreenShareProjectionService {
  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly broadcaster: VoiceBroadcaster,
  ) {}

  activeIn(mediaRoomId: string): Promise<readonly ScreenShareView[]> {
    return this.state.screenShares(mediaRoomId);
  }

  save(share: ScreenShareView): Promise<void> {
    return this.state.saveScreenShare(share);
  }

  remove(mediaRoomId: string, screenStreamId: string): Promise<void> {
    return this.state.removeScreenShare(mediaRoomId, screenStreamId);
  }

  started(share: ScreenShareView): void {
    this.broadcaster.screenStarted(share.mediaRoomId, share);
  }

  updated(share: ScreenShareView): void {
    this.broadcaster.screenUpdated(share.mediaRoomId, share);
  }

  stopped(
    mediaRoomId: string,
    screenStreamId: string,
    reason: "stopped" | "track-ended" | "left" | "permission-revoked" | "failed",
  ): void {
    this.broadcaster.screenStopped(mediaRoomId, screenStreamId, reason);
  }
}
