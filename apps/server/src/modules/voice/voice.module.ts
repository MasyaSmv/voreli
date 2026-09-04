import { Module } from "@nestjs/common";

import { RedisVoiceStateRepository } from "./redis-voice-state.repository.js";
import { VOICE_STATE_REPOSITORY } from "./voice-state.repository.js";

@Module({
  providers: [
    RedisVoiceStateRepository,
    { provide: VOICE_STATE_REPOSITORY, useExisting: RedisVoiceStateRepository },
  ],
  exports: [VOICE_STATE_REPOSITORY],
})
export class VoiceModule {}
