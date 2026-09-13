import { Injectable } from "@nestjs/common";
import type {
  CallConnectionQualityEvent,
  CallParticipantReconnectingEvent,
  DirectCallView,
} from "@voreli/shared";

import { ChatBroadcaster } from "../chat/chat-broadcaster.js";
import { MessagePresenter, type MessageWithAuthor } from "../chat/message-presenter.js";
import { DirectCallBroadcaster } from "./direct-call-broadcaster.js";
import { DirectCallPresenter, type DirectCallWithUsers } from "./direct-call.presenter.js";

@Injectable()
export class DirectCallNotifier {
  constructor(
    private readonly presenter: DirectCallPresenter,
    private readonly calls: DirectCallBroadcaster,
    private readonly chat: ChatBroadcaster,
    private readonly messages: MessagePresenter,
  ) {}

  started(stored: DirectCallWithUsers): DirectCallView {
    const call = this.presenter.toView(stored);
    this.calls.incoming(call);
    this.calls.ringing(call);
    return call;
  }

  answered(stored: DirectCallWithUsers, sessionId: string, mediaRoomId: string): DirectCallView {
    const call = this.presenter.toView(stored);
    this.calls.answered(call, stored.callerSessionId, sessionId, mediaRoomId);
    return call;
  }

  finished(stored: DirectCallWithUsers, historyMessage: MessageWithAuthor | null): DirectCallView {
    const call = this.presenter.toView(stored);
    if (historyMessage) {
      this.chat.messageCreated(this.messages.toView(historyMessage));
      this.calls.ended(call);
    }
    return call;
  }

  view(stored: DirectCallWithUsers): DirectCallView {
    return this.presenter.toView(stored);
  }

  quality(userId: string, event: CallConnectionQualityEvent): void {
    this.calls.quality(userId, event);
  }

  reconnecting(stored: DirectCallWithUsers, event: CallParticipantReconnectingEvent): void {
    this.calls.reconnecting(this.presenter.toView(stored), event);
  }
}
