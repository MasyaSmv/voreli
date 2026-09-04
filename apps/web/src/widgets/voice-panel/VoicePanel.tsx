import type { ChannelView } from "@voreli/shared";

import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { voiceSession } from "../../features/voice-join/voice-session";

export function VoicePanel({ channel }: { readonly channel: ChannelView }) {
  const currentUserId = useSession((state) => state.user?.id);
  const voice = useVoice();
  const own = voice.participants.find((participant) => participant.userId === currentUserId);
  const activeHere = voice.channelId === channel.id;

  return (
    <section className="flex flex-1 flex-col">
      <header className="border-b border-white/10 px-6 py-3">
        <h2 className="text-sm font-medium text-white">Голосовой: {channel.name}</h2>
        <p className="mt-0.5 text-xs text-white/40">
          {connectionLabel(activeHere ? voice.connection : "idle")}
        </p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        {!activeHere ? (
          <button
            type="button"
            onClick={() => void voiceSession.join(channel.id).catch(() => undefined)}
            className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-neutral-950"
          >
            Подключиться
          </button>
        ) : (
          <>
            <ul className="w-full max-w-sm space-y-2">
              {voice.participants.map((participant) => (
                <li
                  key={participant.userId}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    voice.speakingUserIds.has(participant.userId)
                      ? "border-emerald-400 bg-emerald-400/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {participant.userId === currentUserId
                    ? "Вы"
                    : `Участник ${participant.userId.slice(0, 6)}`}
                  {participant.selfMuted ? " · микрофон выключен" : ""}
                  {participant.selfDeafened ? " · звук выключен" : ""}
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!own}
                onClick={() =>
                  void voiceSession.setSelfMuted(!(own?.selfMuted ?? false)).catch(() => undefined)
                }
                className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"
              >
                {own?.selfMuted ? "Включить микрофон" : "Выключить микрофон"}
              </button>
              <button
                type="button"
                disabled={!own}
                onClick={() =>
                  void voiceSession
                    .setSelfDeafened(!(own?.selfDeafened ?? false))
                    .catch(() => undefined)
                }
                className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"
              >
                {own?.selfDeafened ? "Включить звук" : "Выключить звук"}
              </button>
              <button
                type="button"
                onClick={() => void voiceSession.leave().catch(() => undefined)}
                className="rounded-lg bg-red-500/80 px-4 py-2 text-sm"
              >
                Выйти
              </button>
            </div>
          </>
        )}

        {voice.error === null ? null : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-300">{voice.error}</p>
            {activeHere ? (
              <button
                type="button"
                onClick={() => void voiceSession.resumeAudio().catch(() => undefined)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm"
              >
                Разрешить воспроизведение
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function connectionLabel(connection: "idle" | "joining" | "connected" | "reconnecting") {
  if (connection === "joining") return "Подключаемся…";
  if (connection === "connected") return "Голос подключён";
  if (connection === "reconnecting") return "Восстанавливаем соединение…";
  return "Не подключено";
}
