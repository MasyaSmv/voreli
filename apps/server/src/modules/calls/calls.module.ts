import { Module } from "@nestjs/common";

import { CommonModule } from "../../common/common.module.js";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RelationshipsModule } from "../relationships/relationships.module.js";
import { CALL_DEADLINE_SCHEDULER, LocalCallDeadlineScheduler } from "./call-deadline.scheduler.js";
import { DirectCallBroadcaster } from "./direct-call-broadcaster.js";
import { DirectCallGateway } from "./direct-call.gateway.js";
import { DirectCallNotifier } from "./direct-call-notifier.js";
import { DirectCallPresenter } from "./direct-call.presenter.js";
import { DirectCallService } from "./direct-call.service.js";
import { DirectCallStore } from "./direct-call.store.js";

@Module({
  imports: [
    CommonModule,
    RateLimitModule,
    AuthModule,
    ChatModule,
    RealtimeModule,
    RelationshipsModule,
  ],
  providers: [
    DirectCallBroadcaster,
    DirectCallGateway,
    DirectCallNotifier,
    DirectCallPresenter,
    DirectCallService,
    DirectCallStore,
    LocalCallDeadlineScheduler,
    { provide: CALL_DEADLINE_SCHEDULER, useExisting: LocalCallDeadlineScheduler },
  ],
  exports: [DirectCallService, DirectCallStore],
})
export class CallsModule {}
