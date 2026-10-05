import { useEffect, useRef, type KeyboardEvent, type Ref, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { directCallSession } from "../../features/direct-call/direct-call-session";
import { voiceSession } from "../../features/voice-join/voice-session";
import { Avatar } from "../../shared/ui/Avatar";
import { Icon } from "../../shared/ui/Icon";
import { VoiceSettingsPopover } from "../voice-panel/VoiceSettingsPopover";

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
        className="flex h-dvh w-full flex-col overflow-y-auto text-center motion-safe:animate-voreli-call-rise sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:rounded-card sm:border sm:border-line sm:bg-panel sm:shadow-card"
      >
        <div className="flex flex-1 flex-col justify-center sm:flex-none">
          <div className="relative mx-auto flex w-full max-w-xl flex-1 items-center justify-center overflow-hidden rounded-card bg-panel-raised sm:mt-4 sm:aspect-video sm:flex-none">
            {state.remoteCamera ? (
              <video
                ref={(element) => voiceSession.attachRemoteCamera(element)}
                autoPlay
                playsInline
                className="h-full w-full object-cover"
                aria-label={t("call.remoteCamera", { name: peer.displayName })}
              />
            ) : (
              <Avatar
                name={peer.displayName}
                url={peer.avatarUrl}
                className="h-24 w-24 motion-safe:animate-voreli-call-pulse sm:h-20 sm:w-20"
              />
            )}
          </div>
          {state.cameraStatus === "on" ? (
            <div className="mt-2 flex items-center gap-3 rounded-control bg-panel-raised p-2 text-left">
              <video
                ref={(element) => voiceSession.attachOwnCamera(element)}
                autoPlay
                muted
                playsInline
                className="h-20 w-28 rounded-control border border-line bg-black object-cover -scale-x-100"
                aria-label={t("call.ownCamera")}
              />
              <span className="text-sm text-ink-soft">{t("call.ownCamera")}</span>
              {state.cameraSwitchAvailable ? (
                <button
                  type="button"
                  onClick={() =>
                    void voiceSession
                      .switchCamera()
                      .catch((error: unknown) =>
                        console.error("Failed to switch call camera", { error }),
                      )
                  }
                  className="ml-auto min-h-11 touch-manipulation rounded-control border border-line px-3 text-sm text-ink"
                >
                  {t("call.switchCamera")}
                </button>
              ) : null}
            </div>
          ) : null}
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
                  onClick={() =>
                    void voiceSession.resumeAudio().catch((error: unknown) => {
                      console.error("Failed to resume direct-call audio", { error });
                    })
                  }
                  className="mt-2 min-h-11 touch-manipulation rounded-control border border-line px-4 text-sm text-ink"
                >
                  {t("call.enableAudio")}
                </button>
              ) : null}
            </div>
          ) : null}
          {state.cameraError ? (
            <p className="mt-2 text-sm text-danger-soft" role="alert">
              {state.cameraError}
            </p>
          ) : null}
          {state.cameraNetworkPaused ? (
            <p className="mt-2 text-sm text-warning" role="status">
              {t("call.cameraPaused")}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-3 sm:mt-7">
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
                label={state.cameraStatus === "on" ? t("call.cameraOff") : t("call.cameraOn")}
                tone={state.cameraStatus === "on" ? "voice" : "neutral"}
                icon={state.cameraStatus === "on" ? "camera" : "camera-off"}
                action={() =>
                  (state.cameraStatus === "on"
                    ? voiceSession.stopCamera()
                    : voiceSession.startCamera()
                  ).catch((error: unknown) => {
                    console.warn("Call camera action failed", { error });
                  })
                }
              />
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
              <VoiceSettingsPopover />
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
  readonly icon:
    "phone" | "phone-off" | "mic" | "mic-off" | "volume" | "volume-off" | "camera" | "camera-off";
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
    void audioContext.resume().catch((error: unknown) => {
      console.warn("Incoming-call ringtone could not start", { error });
    });

    return () => {
      if (titleTimer !== undefined) window.clearInterval(titleTimer);
      window.clearInterval(ringTimer);
      document.title = originalTitle;
      navigator.vibrate?.(0);
      oscillator.stop();
      void audioContext.close().catch((error: unknown) => {
        console.error("Incoming-call audio context did not close", { error });
      });
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
