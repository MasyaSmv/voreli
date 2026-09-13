import { Module } from "@nestjs/common";

import { CommonModule } from "../../common/common.module.js";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module.js";
import { DatabaseModule } from "../../infra/database/database.module.js";
import { RedisModule } from "../../infra/redis/redis.module.js";
import { MediaModule } from "../../media/media.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { CallsModule } from "../calls/calls.module.js";
import { RedisVoiceStateRepository } from "./redis-voice-state.repository.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { MediaRoomAccessService } from "./media-room-access.service.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VoiceGateway } from "./voice.gateway.js";
import { VoicePermissionRevalidationService } from "./voice-permission-revalidation.service.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { VoiceRoomNotifier } from "./voice-room-notifier.js";
import { VoiceSignalingService } from "./voice-signaling.service.js";
import { VoiceSocketMembershipService } from "./voice-socket-membership.service.js";
import { VoiceTerminalCleanupService } from "./voice-terminal-cleanup.service.js";
import { VOICE_STATE_REPOSITORY } from "./voice-state.repository.js";
import { SpeakingService } from "./speaking.service.js";
import { VoiceModerationPolicy } from "./voice-moderation.policy.js";
import { VoiceParticipantControlService } from "./voice-participant-control.service.js";

@Module({
  imports: [
    CommonModule,
    RateLimitModule,
    DatabaseModule,
    RedisModule,
    MediaModule,
    PermissionsModule,
    RealtimeModule,
    CallsModule,
  ],
  providers: [
    MediaSessionRegistry,
    MediaRoomAccessService,
    VoiceChannelAccessService,
    VoiceBroadcaster,
    VoiceGateway,
    VoicePermissionRevalidationService,
    VoiceRoomService,
    VoiceRoomNotifier,
    VoiceSignalingService,
    VoiceSocketMembershipService,
    VoiceTerminalCleanupService,
    SpeakingService,
    VoiceModerationPolicy,
    VoiceParticipantControlService,
    RedisVoiceStateRepository,
    { provide: VOICE_STATE_REPOSITORY, useExisting: RedisVoiceStateRepository },
  ],
  exports: [VOICE_STATE_REPOSITORY, MediaSessionRegistry],
})
export class VoiceModule {}
