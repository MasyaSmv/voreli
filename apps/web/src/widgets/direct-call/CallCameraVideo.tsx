import { useEffect, useRef } from "react";

import { voiceSession } from "../../features/voice-join/voice-session";

/**
 * The element is handed to the session once, on mount, and taken back on unmount.
 *
 * Not a ref callback: an inline `ref={(element) => ...}` is a new function on every render
 * of the overlay, so React detached and re-attached the element each time and the preview
 * restarted loading on every speaking indicator tick.
 */
function useAttachedVideo(attach: (element: HTMLVideoElement | null) => void) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    attach(element);
    return () => {
      attach(null);
      if (element) element.srcObject = null;
    };
  }, [attach]);
  return video;
}

const attachOwn = (element: HTMLVideoElement | null) => voiceSession.attachOwnCamera(element);
const attachRemote = (element: HTMLVideoElement | null) => voiceSession.attachRemoteCamera(element);

export function OwnCameraPreview({ label }: { readonly label: string }) {
  const video = useAttachedVideo(attachOwn);
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      className="h-20 w-28 rounded-control border border-line bg-black object-cover -scale-x-100"
      aria-label={label}
    />
  );
}

export function RemoteCameraVideo({ label }: { readonly label: string }) {
  const video = useAttachedVideo(attachRemote);
  return (
    <video
      ref={video}
      autoPlay
      playsInline
      className="h-full w-full object-cover"
      aria-label={label}
    />
  );
}
