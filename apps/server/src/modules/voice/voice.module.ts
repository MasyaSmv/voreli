import { Module } from "@nestjs/common";

import { CommonModule } from "../../common/common.module.js";
import { DatabaseModule } from "../../infra/database/database.module.js";
import { RedisModule } from "../../infra/redis/redis.module.js";
import { MediaModule } from "../../media/media.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { RedisVoiceStateRepository } from "./redis-voice-state.repository.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { VOICE_STATE_REPOSITORY } from "./voice-state.repository.js";

@Module({
  imports: [CommonModule, DatabaseModule, RedisModule, MediaModule, PermissionsModule],
  providers: [
    MediaSessionRegistry,
    VoiceChannelAccessService,
    VoiceRoomService,
    RedisVoiceStateRepository,
    { provide: VOICE_STATE_REPOSITORY, useExisting: RedisVoiceStateRepository },
  ],
  exports: [VOICE_STATE_REPOSITORY, MediaSessionRegistry],
})
export class VoiceModule {}
