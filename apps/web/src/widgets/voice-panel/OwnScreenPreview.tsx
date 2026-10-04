import { useEffect, useRef } from "react";

import { voiceSession } from "../../features/voice-join/voice-session";

export function OwnScreenPreview({ label }: { readonly label: string }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    voiceSession.attachOwnScreenPreview(element);
    return () => {
      if (element) element.srcObject = null;
    };
  }, []);

  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label={label}
      className="aspect-video w-full rounded-xl bg-black object-contain"
    />
  );
}
