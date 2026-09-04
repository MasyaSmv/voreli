import { Module } from "@nestjs/common";

import { MediaModule } from "../../media/media.module.js";
import { RedisModule } from "../../infra/redis/redis.module.js";
import { RedisVoiceStateRepository } from "./redis-voice-state.repository.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VOICE_STATE_REPOSITORY } from "./voice-state.repository.js";

@Module({
  imports: [MediaModule, RedisModule],
  providers: [
    MediaSessionRegistry,
    RedisVoiceStateRepository,
    { provide: VOICE_STATE_REPOSITORY, useExisting: RedisVoiceStateRepository },
  ],
  exports: [VOICE_STATE_REPOSITORY, MediaSessionRegistry],
})
export class VoiceModule {}
