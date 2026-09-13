import type { ChannelView } from "@voreli/shared";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useSession } from "../../entities/session/session.store";
import { useVoice, type VoiceConnectionState } from "../../entities/voice/voice.store";
import { voiceSession } from "../../features/voice-join/voice-session";
import { Icon } from "../../shared/ui/Icon";
import { VoiceRoom } from "./VoiceRoom";
import { VoiceSettingsPopover } from "./VoiceSettingsPopover";

export function VoicePanel({
  channel,
  permissions = "0",
}: {
  readonly channel: ChannelView;
  readonly permissions?: string;
}) {
  const { t } = useTranslation();
  const currentUser = useSession((state) => state.user);
  const voice = useVoice();
  const own = voice.participants.find((participant) => participant.userId === currentUser?.id);
  const activeHere = voice.channelId === channel.id;
  const connection = activeHere ? voice.connection : "idle";

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t("voice.channelLabel", { channel: channel.name })}
    >
      <header className="flex min-h-16 items-center justify-between border-b border-line bg-canvas/80 px-6 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-voice/10 text-voice">
            <Icon name="radio" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-ink">{channel.name}</h1>
            <p className="text-xs text-faint">{t("voice.channelType")}</p>
          </div>
        </div>
        <ConnectionStatus connection={connection} t={t} />
      </header>

      {!activeHere ? (
        <JoinView channelName={channel.name} channelId={channel.id} />
      ) : (
        <VoiceRoom
          participants={voice.participants}
          speakingUserIds={voice.speakingUserIds}
          currentUserId={currentUser?.id}
          currentUserName={currentUser?.displayName}
          own={own}
          channelId={channel.id}
          permissions={permissions}
        />
      )}

      {voice.error === null ? null : (
        <div className="mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-xl items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/8 px-4 py-3">
          <p role="alert" className="text-sm text-danger-soft">
            {voice.error}
          </p>
          {activeHere ? (
            <button
              type="button"
              onClick={() => void voiceSession.resumeAudio().catch(() => undefined)}
              className="shrink-0 rounded-lg bg-panel-raised px-3 py-2 text-xs font-semibold text-ink transition hover:bg-panel-hover"
            >
              {t("voice.allowAudio")}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function JoinView({
  channelName,
  channelId,
}: {
  readonly channelName: string;
  readonly channelId: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-8">
      <div className="relative w-full max-w-md rounded-[2rem] border border-line bg-panel/75 px-8 py-10 text-center shadow-[0_28px_80px_rgba(0,0,0,.3)] backdrop-blur">
        <div className="absolute inset-x-16 -top-16 -z-10 h-40 rounded-full bg-voice/10 blur-3xl" />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] bg-voice/10 text-voice ring-1 ring-inset ring-voice/15">
          <Icon name="headphones" className="h-7 w-7" />
        </span>
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-voice">
          {t("voice.channelType")}
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-[-0.035em] text-ink">{channelName}</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted">
          {t("voice.joinDescription")}
        </p>
        <button
          type="button"
          onClick={() => void voiceSession.join(channelId).catch(() => undefined)}
          className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-voice px-5 text-sm font-bold text-voice-ink shadow-voice transition hover:-translate-y-0.5 hover:bg-voice-hover"
        >
          <Icon name="radio" className="h-4 w-4" />
          {t("voice.join")}
        </button>
        <div className="mt-3 flex justify-center">
          <VoiceSettingsPopover placement="side" />
        </div>
      </div>
    </div>
  );
}

function ConnectionStatus({
  connection,
  t,
}: {
  readonly connection: VoiceConnectionState;
  readonly t: TFunction;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted" role="status">
      <span
        className={
          "h-2 w-2 rounded-full " +
          (connection === "connected"
            ? "bg-voice"
            : connection === "idle"
              ? "bg-faint"
              : "animate-pulse bg-warning")
        }
      />
      {connectionLabel(connection, t)}
    </div>
  );
}

function connectionLabel(connection: VoiceConnectionState, t: TFunction): string {
  if (connection === "joining") return t("voice.joining");
  if (connection === "connected") return t("voice.connected");
  if (connection === "reconnecting") return t("voice.reconnecting");
  return t("voice.disconnected");
}
