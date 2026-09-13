import {
  hasPermission,
  parsePermissions,
  Permission,
  type VoiceParticipantView,
} from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { voiceSession } from "../../features/voice-join/voice-session";
import { Avatar } from "../../shared/ui/Avatar";
import { VoiceControls } from "./VoiceControls";

interface VoiceRoomProps {
  readonly participants: readonly VoiceParticipantView[];
  readonly speakingUserIds: ReadonlySet<string>;
  readonly currentUserId: string | undefined;
  readonly currentUserName: string | undefined;
  readonly own: VoiceParticipantView | undefined;
  readonly channelId: string;
  readonly permissions: string;
}

export function VoiceRoom({
  participants,
  speakingUserIds,
  currentUserId,
  currentUserName,
  own,
  channelId,
  permissions,
}: VoiceRoomProps) {
  const { t } = useTranslation();
  const permissionMask = parsePermissions(permissions);
  const canMute = hasPermission(permissionMask, Permission.MuteMembers);
  const canDeafen = hasPermission(permissionMask, Permission.DeafenMembers);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto max-w-4xl">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
                {t("voice.onAir")}
              </p>
              <h2 className="mt-1 text-lg font-bold text-ink">
                {t("voice.participantCount", { count: participants.length })}
              </h2>
            </div>
            <button
              type="button"
              disabled={!own || own.selfMuted}
              onClick={() =>
                void voiceSession.startEcho().catch((error: unknown) => {
                  console.error("Failed to start the voice echo test", { error });
                })
              }
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
            >
              {t("voice.echo")}
            </button>
          </div>

          <ul className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
            {participants.map((participant) => {
              const isCurrentUser = participant.userId === currentUserId;
              const name = isCurrentUser
                ? (currentUserName ?? t("common.you"))
                : t("workspace.participant", { id: participant.userId.slice(0, 6) });
              const speaking = speakingUserIds.has(participant.userId);

              return (
                <li
                  key={participant.userId}
                  className={
                    "relative min-h-44 overflow-hidden rounded-2xl border bg-panel px-5 py-6 text-center transition " +
                    (speaking
                      ? "border-voice/55 shadow-[0_0_0_1px_rgba(73,211,160,.16),0_16px_45px_rgba(0,0,0,.18)]"
                      : "border-line")
                  }
                >
                  <span
                    className={
                      "mx-auto block w-fit rounded-[40%] p-1 transition " +
                      (speaking ? "bg-voice/70 shadow-[0_0_28px_rgba(73,211,160,.25)]" : "bg-line")
                    }
                  >
                    <Avatar name={name} size="lg" />
                  </span>
                  <p className="mt-4 truncate text-sm font-bold text-ink">
                    {isCurrentUser ? t("common.you") : name}
                  </p>
                  <ParticipantState participant={participant} speaking={speaking} />
                  {!isCurrentUser && (canMute || canDeafen) ? (
                    <div className="mt-3 flex justify-center gap-2">
                      {canMute ? (
                        <button
                          type="button"
                          onClick={() =>
                            void voiceSession
                              .setModeratorState({
                                channelId,
                                userId: participant.userId,
                                moderatorMuted: !participant.moderatorMuted,
                                moderatorDeafened: participant.moderatorDeafened,
                              })
                              .catch((error: unknown) => {
                                console.error("Failed to update moderator mute", { error });
                              })
                          }
                          className="rounded-lg bg-panel-raised px-2.5 py-1.5 text-xs text-muted"
                        >
                          {participant.moderatorMuted
                            ? t("voice.moderation.unmute")
                            : t("voice.moderation.mute")}
                        </button>
                      ) : null}
                      {canDeafen ? (
                        <button
                          type="button"
                          onClick={() =>
                            void voiceSession
                              .setModeratorState({
                                channelId,
                                userId: participant.userId,
                                moderatorMuted: participant.moderatorMuted,
                                moderatorDeafened: !participant.moderatorDeafened,
                              })
                              .catch((error: unknown) => {
                                console.error("Failed to update moderator deafen", { error });
                              })
                          }
                          className="rounded-lg bg-panel-raised px-2.5 py-1.5 text-xs text-muted"
                        >
                          {participant.moderatorDeafened
                            ? t("voice.moderation.undeafen")
                            : t("voice.moderation.deafen")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <VoiceControls own={own} />
    </div>
  );
}

function ParticipantState({
  participant,
  speaking,
}: {
  readonly participant: VoiceParticipantView;
  readonly speaking: boolean;
}) {
  const { t } = useTranslation();
  const state =
    participant.selfDeafened || participant.moderatorDeafened
      ? t("voice.soundOff")
      : participant.selfMuted || participant.moderatorMuted
        ? t("voice.microphoneOff")
        : speaking
          ? t("voice.speaking")
          : t("voice.listening");

  return <p className={"mt-1.5 text-xs " + (speaking ? "text-voice" : "text-faint")}>{state}</p>;
}
