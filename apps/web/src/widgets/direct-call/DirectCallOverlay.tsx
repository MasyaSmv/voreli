import { useEffect, useRef, type KeyboardEvent, type Ref, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { directCallSession } from "../../features/direct-call/direct-call-session";
import { voiceSession } from "../../features/voice-join/voice-session";
import { Avatar } from "../../shared/ui/Avatar";
import { Icon } from "../../shared/ui/Icon";

export function DirectCallOverlay() {
  const { t } = useTranslation();
  const currentUser = useSession((state) => state.user);
  const state = useDirectCall();
  const voice = useVoice();
  const dialogRef = useRef<HTMLElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const ownVoice = voice.participants.find((participant) => participant.userId === currentUser?.id);
  const active = state.call?.status === "ACTIVE";
  const incoming = state.call?.status === "RINGING" && state.call.callee.id === currentUser?.id;

  useWakeLock(active);
  useIncomingCallAttention(incoming, t("call.incoming"));
  useDialogFocus(dialogRef, declineRef, state.call?.id ?? null, incoming);

  if (!state.call || !currentUser) return null;
  const outgoing = state.call.caller.id === currentUser.id;
  const peer = outgoing ? state.call.callee : state.call.caller;
  const reconnecting = voice.connection === "reconnecting" || state.reconnectingUserId !== null;

  return (
    <div className="fixed inset-0 z-50 grid min-h-dvh bg-canvas sm:place-items-center sm:bg-black/65 sm:p-4 sm:backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("call.with", { name: peer.displayName })}
        tabIndex={-1}
        onKeyDown={trapDialogFocus}
        style={{
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingRight: "max(1.5rem, env(safe-area-inset-right))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        }}
        className="flex min-h-dvh w-full flex-col text-center motion-safe:animate-voreli-call-rise sm:min-h-0 sm:max-w-sm sm:rounded-card sm:border sm:border-line sm:bg-panel sm:shadow-card"
      >
        <div className="flex flex-1 flex-col justify-center sm:flex-none">
          <Avatar
            name={peer.displayName}
            url={peer.avatarUrl}
            className="mx-auto h-24 w-24 motion-safe:animate-voreli-call-pulse sm:h-20 sm:w-20"
          />
          <h2 className="mt-5 text-xl font-bold text-ink">{peer.displayName}</h2>
          <p className="mt-1 text-sm text-muted">@{peer.username}</p>
          <p
            className={`mt-4 text-sm ${reconnecting ? "text-warning" : "text-ink-soft"}`}
            role="status"
          >
            {state.call.status === "RINGING"
              ? outgoing
                ? t("call.ringing")
                : t("call.incoming")
              : reconnecting
                ? t("call.reconnecting")
                : t("call.active")}
          </p>

          {state.error || voice.error ? (
            <div className="mt-3" role="alert">
              <p className="text-sm text-danger-soft">{state.error ?? voice.error}</p>
              {active ? (
                <button
                  type="button"
                  onClick={() => void voiceSession.resumeAudio().catch(() => undefined)}
                  className="mt-2 min-h-11 touch-manipulation rounded-control border border-line px-4 text-sm text-ink"
                >
                  {t("call.enableAudio")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-8 flex justify-center gap-5 sm:mt-7">
          {state.call.status === "RINGING" && !outgoing ? (
            <>
              <CallButton
                buttonRef={declineRef}
                label={t("call.decline")}
                tone="danger"
                icon="phone-off"
                primary
                action={() => directCallSession.decline()}
              />
              <CallButton
                label={t("call.accept")}
                tone="voice"
                icon="phone"
                primary
                action={() => directCallSession.accept()}
              />
            </>
          ) : null}
          {state.call.status === "RINGING" && outgoing ? (
            <CallButton
              label={t("call.cancel")}
              tone="danger"
              icon="phone-off"
              primary
              action={() => directCallSession.cancel()}
            />
          ) : null}
          {active ? (
            <>
              <CallButton
                label={ownVoice?.selfMuted ? t("call.unmute") : t("call.mute")}
                tone={ownVoice?.selfMuted ? "muted" : "neutral"}
                icon={ownVoice?.selfMuted ? "mic-off" : "mic"}
                action={() => voiceSession.setSelfMuted(!(ownVoice?.selfMuted ?? false))}
              />
              <CallButton
                label={ownVoice?.selfDeafened ? t("call.soundOn") : t("call.soundOff")}
                tone={ownVoice?.selfDeafened ? "muted" : "neutral"}
                icon={ownVoice?.selfDeafened ? "volume-off" : "volume"}
                action={() => voiceSession.setSelfDeafened(!(ownVoice?.selfDeafened ?? false))}
              />
              <CallButton
                label={t("call.hangup")}
                tone="danger"
                icon="phone-off"
                primary
                action={() => directCallSession.hangup()}
              />
            </>
          ) : null}
        </div>
        {active && (state.quality === "constrained" || state.quality === "poor") ? (
          <p className={`mt-5 text-xs ${state.quality === "poor" ? "text-warning" : "text-muted"}`}>
            {t(`call.quality.${state.quality}`)}
          </p>
        ) : (
          <div className="h-5" aria-hidden="true" />
        )}
      </section>
    </div>
  );
}

function CallButton({
  label,
  tone,
  icon,
  primary = false,
  buttonRef,
  action,
}: {
  readonly label: string;
  readonly tone: "voice" | "danger" | "neutral" | "muted";
  readonly icon: "phone" | "phone-off" | "mic" | "mic-off" | "volume" | "volume-off";
  readonly primary?: boolean;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly action: () => Promise<void>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() =>
        void action().catch((error: unknown) =>
          useDirectCall
            .getState()
            .replace({ error: error instanceof Error ? error.message : "Call action failed" }),
        )
      }
      aria-label={label}
      title={label}
      className={
        `grid touch-manipulation place-items-center rounded-full transition ${primary ? "h-16 w-16" : "h-[3.25rem] w-[3.25rem]"} ` +
        (tone === "voice"
          ? "bg-voice text-voice-ink hover:bg-voice-hover"
          : tone === "danger"
            ? "bg-danger text-white hover:brightness-110"
            : tone === "muted"
              ? "bg-panel-hover text-warning"
              : "bg-panel-raised text-ink hover:bg-panel-hover")
      }
    >
      <Icon name={icon} className={primary ? "h-7 w-7" : "h-[1.375rem] w-[1.375rem]"} />
    </button>
  );
}

function trapDialogFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key !== "Tab") return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (buttons.length === 0) return;
  const first = buttons[0];
  const last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  declineRef: RefObject<HTMLButtonElement | null>,
  callId: string | null,
  incoming: boolean,
): void {
  useEffect(() => {
    if (!callId) return;
    const frame = window.requestAnimationFrame(() => {
      if (incoming) declineRef.current?.focus();
      else dialogRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [callId, declineRef, dialogRef, incoming]);
}

function useIncomingCallAttention(incoming: boolean, incomingTitle: string): void {
  useEffect(() => {
    if (!incoming) return;
    const originalTitle = document.title;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.title = incomingTitle;
    const titleTimer = reduceMotion
      ? undefined
      : window.setInterval(() => {
          document.title = document.title === incomingTitle ? originalTitle : incomingTitle;
        }, 1_000);
    navigator.vibrate?.([200, 150, 200]);

    if (!("AudioContext" in window)) {
      return () => {
        if (titleTimer !== undefined) window.clearInterval(titleTimer);
        document.title = originalTitle;
        navigator.vibrate?.(0);
      };
    }
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.035;
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    const ringTimer = window.setInterval(() => {
      gain.gain.value = gain.gain.value === 0 ? 0.035 : 0;
    }, 650);
    void audioContext.resume().catch(() => undefined);

    return () => {
      if (titleTimer !== undefined) window.clearInterval(titleTimer);
      window.clearInterval(ringTimer);
      document.title = originalTitle;
      navigator.vibrate?.(0);
      oscillator.stop();
      void audioContext.close().catch(() => undefined);
    };
  }, [incoming, incomingTitle]);
}

function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;
    const wakeLock = navigator.wakeLock;
    void wakeLock.request("screen").then((lock) => {
      if (released) void lock.release();
      else sentinel = lock;
    });
    return () => {
      released = true;
      if (sentinel) void sentinel.release();
    };
  }, [active]);
}
