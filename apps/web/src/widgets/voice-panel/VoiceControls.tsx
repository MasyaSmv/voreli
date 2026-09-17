import type { VoiceParticipantView } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { voiceSession } from "../../features/voice-join/voice-session";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { VoiceSettingsPopover } from "./VoiceSettingsPopover";

export function VoiceControls({ own }: { readonly own: VoiceParticipantView | undefined }) {
  const { t } = useTranslation();
  const effectivelyMuted = (own?.selfMuted ?? false) || (own?.moderatorMuted ?? false);
  const effectivelyDeafened = (own?.selfDeafened ?? false) || (own?.moderatorDeafened ?? false);

  return (
    <footer className="border-t border-line bg-panel/90 px-6 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-2">
        <ControlButton
          label={own?.selfMuted ? t("voice.enableMicrophone") : t("voice.disableMicrophone")}
          icon={effectivelyMuted ? "mic-off" : "mic"}
          active={effectivelyMuted}
          disabled={!own}
          onClick={() =>
            void voiceSession.setSelfMuted(!(own?.selfMuted ?? false)).catch((error: unknown) => {
              console.error("Failed to update self mute", { error });
            })
          }
        />
        <VoiceSettingsPopover />
        <ControlButton
          label={own?.selfDeafened ? t("voice.enableSound") : t("voice.disableSound")}
          icon={effectivelyDeafened ? "volume-off" : "volume"}
          active={effectivelyDeafened}
          disabled={!own}
          onClick={() =>
            void voiceSession
              .setSelfDeafened(!(own?.selfDeafened ?? false))
              .catch((error: unknown) => {
                console.error("Failed to update self deafen", { error });
              })
          }
        />
        <button
          type="button"
          onClick={() => void voiceSession.leave().catch(() => undefined)}
          aria-label={t("voice.leave")}
          className="ml-2 grid h-11 w-11 place-items-center rounded-xl bg-danger text-white transition hover:bg-danger-hover"
        >
          <Icon name="phone-off" className="h-5 w-5" />
        </button>
      </div>
    </footer>
  );
}

interface ControlButtonProps {
  readonly label: string;
  readonly icon: IconName;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function ControlButton({ label, icon, active, disabled, onClick }: ControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={
        "grid h-11 w-11 place-items-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-35 " +
        (active
          ? "border-danger/25 bg-danger/12 text-danger-soft"
          : "border-line bg-panel-raised text-ink-soft hover:border-line-strong hover:bg-panel-hover")
      }
    >
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}
