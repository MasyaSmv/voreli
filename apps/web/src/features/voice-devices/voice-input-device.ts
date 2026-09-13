/**
 * `null` and the absent setting both mean the system default, so they compare equal. Kept
 * apart from the class because it is the whole of the reuse decision and the only part of it
 * that can be checked without a real microphone.
 */
export function matchesRequestedDevice(
  activeDeviceId: string | undefined,
  requestedDeviceId: string | null,
): boolean {
  return (activeDeviceId ?? "default") === (requestedDeviceId ?? "default");
}

export interface VoiceInputTarget {
  replaceInputTrack(track: MediaStreamTrack): Promise<void>;
  observeInputTrack(track: MediaStreamTrack): void;
}

/** The single explicit owner of the captured microphone track. */
export class VoiceInputDevice {
  private track: MediaStreamTrack | undefined;

  capture(deviceId: string | null): Promise<MediaStream> {
    if (this.track?.readyState === "live" && this.matches(this.track, deviceId)) {
      return Promise.resolve(new MediaStream([this.track]));
    }
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: { exact: deviceId ?? "default" },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      .then((stream) => {
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error("The selected input did not provide an audio track");
        this.release();
        this.track = track;
        return new MediaStream([track]);
      });
  }

  async switchTo(deviceId: string | null, target: VoiceInputTarget): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId ?? "default" },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const next = stream.getAudioTracks()[0];
    if (!next) throw new Error("The selected input did not provide an audio track");
    const previous = this.track;
    try {
      await target.replaceInputTrack(next);
      target.observeInputTrack(next);
      this.track = next;
      previous?.stop();
    } catch (error: unknown) {
      next.stop();
      throw error;
    }
  }

  adopt(stream: MediaStream): MediaStream {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("The prepared input did not provide an audio track");
    if (this.track !== track) {
      this.release();
      this.track = track;
    }
    return new MediaStream([track]);
  }

  release(): void {
    this.track?.stop();
    this.track = undefined;
  }

  private matches(track: MediaStreamTrack, deviceId: string | null): boolean {
    return matchesRequestedDevice(track.getSettings().deviceId, deviceId);
  }
}
