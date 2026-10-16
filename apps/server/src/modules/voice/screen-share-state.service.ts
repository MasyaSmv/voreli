import { Injectable } from "@nestjs/common";
import type { ScreenShareView, VoiceMediaSource } from "@voreli/shared";

export interface PendingScreenShare {
  readonly id: string;
  readonly mediaRoomId: string;
  readonly userId: string;
  readonly sessionId: string;
  videoProducerId: string | null;
  audioProducerId: string | null;
}

export type ActiveScreenShare = ScreenShareView & { readonly sessionId: string };

@Injectable()
export class ScreenShareStateService {
  private readonly pendingBySession = new Map<string, PendingScreenShare>();
  private readonly activeById = new Map<string, ActiveScreenShare>();
  private readonly stopping = new Set<string>();

  pending(sessionId: string): PendingScreenShare | undefined {
    return this.pendingBySession.get(sessionId);
  }

  pendingForUser(userId: string, mediaRoomId: string): PendingScreenShare | undefined {
    return [...this.pendingBySession.values()].find(
      (share) => share.userId === userId && share.mediaRoomId === mediaRoomId,
    );
  }

  begin(share: PendingScreenShare): void {
    this.pendingBySession.set(share.sessionId, share);
  }

  recordProducer(sessionId: string, producerId: string, source: VoiceMediaSource): void {
    const pending = this.pendingBySession.get(sessionId);
    if (!pending) return;
    if (source === "screen-video") pending.videoProducerId = producerId;
    else pending.audioProducerId = producerId;
  }

  removePending(sessionId: string): void {
    this.pendingBySession.delete(sessionId);
  }

  producerClosed(producerId: string): PendingScreenShare | undefined {
    for (const [sessionId, pending] of this.pendingBySession) {
      if (pending.videoProducerId !== producerId && pending.audioProducerId !== producerId)
        continue;
      if (pending.audioProducerId === producerId) {
        pending.audioProducerId = null;
      } else {
        this.pendingBySession.delete(sessionId);
        return pending;
      }
      break;
    }
    return undefined;
  }

  active(id: string): ActiveScreenShare | undefined {
    return this.activeById.get(id);
  }

  activeForSession(sessionId: string): ActiveScreenShare | undefined {
    return [...this.activeById.values()].find((share) => share.sessionId === sessionId);
  }

  activeForUser(userId: string, mediaRoomId: string): ActiveScreenShare | undefined {
    return [...this.activeById.values()].find(
      (share) => share.userId === userId && share.mediaRoomId === mediaRoomId,
    );
  }

  activate(share: ActiveScreenShare): void {
    this.pendingBySession.delete(share.sessionId);
    this.activeById.set(share.id, share);
  }

  updateAudio(share: ActiveScreenShare): ActiveScreenShare {
    const updated = { ...share, audioProducerId: null };
    this.activeById.set(share.id, updated);
    return updated;
  }

  removeActive(id: string): void {
    this.activeById.delete(id);
  }

  startStopping(id: string): void {
    this.stopping.add(id);
  }

  stopStopping(id: string): void {
    this.stopping.delete(id);
  }

  isStopping(id: string): boolean {
    return this.stopping.has(id);
  }
}
