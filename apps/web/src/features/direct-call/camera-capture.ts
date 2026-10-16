/**
 * Where camera tracks come from, narrowed to the three questions a call asks.
 *
 * A contract rather than direct `navigator.mediaDevices` calls because the camera logic on
 * top of it — generations, races, server cleanup — is what needs tests, and jsdom has no
 * media devices. A test answers these questions with its own tracks; the browser answers
 * them with real ones.
 */
export interface CameraCapture {
  /** The front camera at call quality. */
  open(): Promise<MediaStreamTrack>;
  /**
   * One specific camera. `constrained: false` drops the size and rate hints: a camera that
   * refused them while busy is retried with nothing it could refuse.
   */
  openDevice(deviceId: string, constrained: boolean): Promise<MediaStreamTrack>;
  /** Device ids of every camera the page may see. */
  videoInputs(): Promise<readonly string[]>;
}

const callVideo = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
} as const satisfies MediaTrackConstraints;

export class BrowserCameraCapture implements CameraCapture {
  open(): Promise<MediaStreamTrack> {
    return this.capture({ facingMode: "user", ...callVideo });
  }

  openDevice(deviceId: string, constrained: boolean): Promise<MediaStreamTrack> {
    return this.capture(
      constrained
        ? { deviceId: { exact: deviceId }, ...callVideo }
        : { deviceId: { exact: deviceId } },
    );
  }

  async videoInputs(): Promise<readonly string[]> {
    return (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "videoinput")
      .map((device) => device.deviceId);
  }

  private async capture(video: MediaTrackConstraints): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((current) => current.stop());
      throw new Error("Camera did not provide a video track");
    }
    return track;
  }
}
