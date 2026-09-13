import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useVoiceSettings } from "../../entities/voice-settings/voice-settings.store";
import { voiceSession } from "../../features/voice-join/voice-session";
import { Icon } from "../../shared/ui/Icon";

export function VoiceSettingsPopover({
  placement = "above",
}: {
  readonly placement?: "above" | "side";
}) {
  const { t } = useTranslation();
  const settings = useVoiceSettings();
  const setInputError = useVoiceSettings((state) => state.setInputError);
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [inputs, setInputs] = useState<readonly MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) {
      setInputError(t("voice.devices.error"));
      return;
    }
    const refresh = () => {
      void mediaDevices
        .enumerateDevices()
        .then((devices) => setInputs(devices.filter((device) => device.kind === "audioinput")))
        .catch((error: unknown) =>
          setInputError(error instanceof Error ? error.message : t("voice.devices.error")),
        );
    };
    refresh();
    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, [open, setInputError, t]);

  useEffect(() => () => voiceSession.stopMicrophonePreview(), []);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("voice.devices.open")}
        aria-expanded={open}
        onClick={() => {
          if (open && previewing) {
            voiceSession.stopMicrophonePreview();
            setPreviewing(false);
          }
          setOpen(!open);
        }}
        className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-panel-raised text-ink-soft transition hover:border-line-strong hover:bg-panel-hover"
      >
        <Icon name="settings" className="h-5 w-5" />
      </button>
      {open ? (
        <div
          className={`absolute z-30 w-80 rounded-2xl border border-line bg-panel p-4 text-left shadow-2xl ${placement === "side" ? "bottom-0 left-14" : "bottom-14 right-0"}`}
        >
          <h3 className="text-sm font-bold text-ink">{t("voice.devices.title")}</h3>
          <label className="mt-4 block text-xs font-semibold text-muted">
            {t("voice.devices.input")}
            <select
              value={settings.inputDeviceId ?? ""}
              onChange={(event) =>
                void voiceSession
                  .selectInputDevice(event.target.value || null)
                  .catch(reportVoiceActionFailure)
              }
              className="mt-1.5 min-h-10 w-full rounded-lg border border-line bg-panel-raised px-3 text-sm text-ink"
            >
              <option value="">{t("voice.devices.systemDefault")}</option>
              {inputs.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t("voice.devices.microphone", { number: index + 1 })}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block text-xs font-semibold text-muted">
            {t("voice.devices.inputMode")}
            <select
              value={settings.inputMode}
              onChange={(event) =>
                settings.update({
                  inputMode: event.target.value as "voice-activity" | "push-to-talk",
                })
              }
              className="mt-1.5 min-h-10 w-full rounded-lg border border-line bg-panel-raised px-3 text-sm text-ink"
            >
              <option value="voice-activity">{t("voice.devices.voiceActivity")}</option>
              <option value="push-to-talk">{t("voice.devices.pushToTalk")}</option>
            </select>
          </label>

          {settings.inputMode === "voice-activity" ? (
            <label className="mt-3 block text-xs font-semibold text-muted">
              {t("voice.devices.threshold", { value: settings.voiceActivityThresholdDb })}
              <input
                type="range"
                min={-60}
                max={-10}
                value={settings.voiceActivityThresholdDb}
                onChange={(event) =>
                  settings.update({ voiceActivityThresholdDb: Number(event.target.value) })
                }
                className="mt-2 w-full accent-voice"
              />
            </label>
          ) : (
            <label className="mt-3 block text-xs font-semibold text-muted">
              {t("voice.devices.pttKey")}
              <input
                readOnly
                value={settings.pushToTalkCode}
                onKeyDown={(event) => {
                  event.preventDefault();
                  if (!event.repeat) settings.update({ pushToTalkCode: event.code });
                }}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-line bg-panel-raised px-3 text-sm text-ink"
              />
            </label>
          )}

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full bg-voice transition-[width]"
              style={{ width: `${Math.max(0, Math.min(100, settings.microphoneLevelDb + 100))}%` }}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (previewing) voiceSession.stopMicrophonePreview();
                else void voiceSession.previewMicrophone().catch(reportVoiceActionFailure);
                setPreviewing((value) => !value);
              }}
              className="min-h-10 flex-1 rounded-lg bg-panel-raised px-3 text-xs font-semibold text-ink"
            >
              {previewing ? t("voice.devices.stopTest") : t("voice.devices.test")}
            </button>
            <button
              type="button"
              onClick={() => void voiceSession.selectOutputDevice().catch(reportVoiceActionFailure)}
              className="min-h-10 flex-1 rounded-lg bg-panel-raised px-3 text-xs font-semibold text-ink"
            >
              {voiceSession.outputSelectionSupported
                ? t("voice.devices.chooseOutput")
                : t("voice.devices.systemOutput")}
            </button>
          </div>
          {(settings.inputError ?? settings.outputWarning) ? (
            <p role="alert" className="mt-3 text-xs text-danger-soft">
              {settings.inputError ?? settings.outputWarning}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function reportVoiceActionFailure(error: unknown): void {
  console.error("Voice device action failed", { error });
}
