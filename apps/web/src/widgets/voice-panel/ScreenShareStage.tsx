import type { ScreenShareView } from "@voreli/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { voiceSession } from "../../features/voice-join/voice-session";
import { useVoice } from "../../entities/voice/voice.store";

function reportScreenCommandFailure(error: unknown): void {
  console.error("Screen-share command failed", { error });
}

interface ScreenShareStageProps {
  readonly screenShare: ScreenShareView;
}

export function ScreenShareStage({ screenShare }: ScreenShareStageProps) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const audioBlocked = useVoice((state) => state.screenAudioBlocked);

  useEffect(() => {
    container.current?.scrollIntoView({ block: "start" });
  }, [screenShare.id]);

  useEffect(() => {
    void voiceSession.attachScreenVideo(video.current).catch((error: unknown) => {
      console.error("Failed to attach screen share video", { error });
    });
    return () => {
      void voiceSession.attachScreenVideo(null).catch((error: unknown) => {
        console.error("Failed to detach screen share video", { error });
      });
    };
  }, [screenShare.id]);

  useEffect(() => {
    const element = video.current;
    const updateVisibility = (): void => {
      const pictureInPicture = document.pictureInPictureElement === element;
      void voiceSession
        .setScreenShareVisible(document.visibilityState === "visible" || pictureInPicture)
        .catch(reportScreenCommandFailure);
    };
    const updateLayer = (): void => {
      const pictureInPicture = document.pictureInPictureElement === element;
      const width = container.current?.getBoundingClientRect().width ?? 0;
      const layer = expanded || pictureInPicture ? 2 : width < 480 ? 0 : 1;
      void voiceSession.setScreenShareLayer(layer).catch(reportScreenCommandFailure);
    };
    document.addEventListener("visibilitychange", updateVisibility);
    element?.addEventListener("enterpictureinpicture", updateVisibility);
    element?.addEventListener("leavepictureinpicture", updateVisibility);
    element?.addEventListener("enterpictureinpicture", updateLayer);
    element?.addEventListener("leavepictureinpicture", updateLayer);
    const resize = new ResizeObserver(updateLayer);
    if (container.current) resize.observe(container.current);
    updateVisibility();
    updateLayer();
    return () => {
      resize.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      element?.removeEventListener("enterpictureinpicture", updateVisibility);
      element?.removeEventListener("leavepictureinpicture", updateVisibility);
      element?.removeEventListener("enterpictureinpicture", updateLayer);
      element?.removeEventListener("leavepictureinpicture", updateLayer);
    };
  }, [expanded, screenShare.id]);

  const detach = async (): Promise<void> => {
    const element = video.current;
    if (element && document.pictureInPictureEnabled) {
      try {
        await element.requestPictureInPicture();
        await voiceSession.setScreenShareLayer(2);
        return;
      } catch (error: unknown) {
        console.warn("Picture-in-picture is unavailable; using the in-app viewer", { error });
      }
    }
    setExpanded((current) => !current);
  };

  return (
    <section
      ref={container}
      className={`${expanded ? "fixed inset-3 z-50 sm:inset-6" : "mt-4"} overflow-hidden rounded-2xl border border-line bg-black shadow-2xl`}
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        className="aspect-video max-h-[min(65vh,48rem)] w-full object-contain"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-3 py-3 sm:px-4">
        <p className="w-full truncate text-sm font-semibold text-ink sm:min-w-0 sm:flex-1">
          {t("voice.screen.participant", { id: screenShare.userId.slice(0, 6) })}
        </p>
        <button
          type="button"
          hidden={!audioBlocked}
          onClick={() =>
            void voiceSession.resumeScreenShareAudio().catch(reportScreenCommandFailure)
          }
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink"
        >
          {t("voice.enableSound")}
        </button>
        <button
          type="button"
          onClick={() => void detach().catch(reportScreenCommandFailure)}
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink"
        >
          {expanded ? t("voice.screen.restore") : t("voice.screen.detach")}
        </button>
        <button
          type="button"
          onClick={() => void voiceSession.unwatchScreenShare().catch(reportScreenCommandFailure)}
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink"
        >
          {t("voice.screen.stopWatching")}
        </button>
      </div>
    </section>
  );
}
