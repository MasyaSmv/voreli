import { create } from "zustand";

export type VoiceInputMode = "voice-activity" | "push-to-talk";

export interface VoiceSettings {
  readonly inputDeviceId: string | null;
  readonly outputDeviceId: string | null;
  readonly inputMode: VoiceInputMode;
  readonly voiceActivityThresholdDb: number;
  readonly pushToTalkCode: string;
}

const STORAGE_KEY = "voreli.voice-settings.v1";
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  inputMode: "voice-activity",
  voiceActivityThresholdDb: -35,
  pushToTalkCode: "KeyV",
};

interface VoiceSettingsState extends VoiceSettings {
  readonly microphoneLevelDb: number;
  readonly inputError: string | null;
  readonly outputWarning: string | null;
  update: (settings: Partial<VoiceSettings>) => void;
  setMicrophoneLevel: (levelDb: number) => void;
  setInputError: (error: string | null) => void;
  setOutputWarning: (warning: string | null) => void;
}

export function parseVoiceSettings(raw: string | null): VoiceSettings {
  if (raw === null) return DEFAULT_VOICE_SETTINGS;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      inputDeviceId: deviceId(value["inputDeviceId"]),
      outputDeviceId: deviceId(value["outputDeviceId"]),
      inputMode:
        value["inputMode"] === "voice-activity" || value["inputMode"] === "push-to-talk"
          ? value["inputMode"]
          : DEFAULT_VOICE_SETTINGS.inputMode,
      voiceActivityThresholdDb:
        typeof value["voiceActivityThresholdDb"] === "number" &&
        value["voiceActivityThresholdDb"] >= -60 &&
        value["voiceActivityThresholdDb"] <= -10
          ? value["voiceActivityThresholdDb"]
          : DEFAULT_VOICE_SETTINGS.voiceActivityThresholdDb,
      pushToTalkCode:
        typeof value["pushToTalkCode"] === "string" && value["pushToTalkCode"].trim().length > 0
          ? value["pushToTalkCode"]
          : DEFAULT_VOICE_SETTINGS.pushToTalkCode,
    };
  } catch (error: unknown) {
    console.warn("Ignoring invalid persisted voice settings", { error });
    return DEFAULT_VOICE_SETTINGS;
  }
}

function deviceId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function initialSettings(): VoiceSettings {
  return parseVoiceSettings(
    typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY),
  );
}

function persist(settings: VoiceSettings): void {
  if (typeof window !== "undefined")
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useVoiceSettings = create<VoiceSettingsState>((set, get) => ({
  ...initialSettings(),
  microphoneLevelDb: -100,
  inputError: null,
  outputWarning: null,
  update(settings) {
    set(settings);
    const current = get();
    persist({
      inputDeviceId: current.inputDeviceId,
      outputDeviceId: current.outputDeviceId,
      inputMode: current.inputMode,
      voiceActivityThresholdDb: current.voiceActivityThresholdDb,
      pushToTalkCode: current.pushToTalkCode,
    });
  },
  setMicrophoneLevel(microphoneLevelDb) {
    set({ microphoneLevelDb });
  },
  setInputError(inputError) {
    set({ inputError });
  },
  setOutputWarning(outputWarning) {
    set({ outputWarning });
  },
}));
