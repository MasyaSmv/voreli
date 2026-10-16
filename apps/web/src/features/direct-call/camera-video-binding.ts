import type { CameraView } from "./camera-media";

/**
 * Puts a camera track into a `<video>` element and keeps it there.
 *
 * Assigning `srcObject` is not free: the element drops its current frame and restarts
 * loading, so `videoWidth` falls back to 0 until the next frame decodes. The stream is
 * therefore created once per track, only once there is an element to show it in, and
 * assigned only when the element does not already show it — re-attaching the same element
 * or showing the same track again changes nothing.
 */
export class CameraVideoBinding implements CameraView {
  private element: HTMLVideoElement | null = null;
  private track: MediaStreamTrack | null = null;
  private stream: { readonly track: MediaStreamTrack; readonly media: MediaStream } | null = null;

  show(track: MediaStreamTrack | null): void {
    this.track = track;
    this.render();
  }

  attach(element: HTMLVideoElement | null): void {
    this.element = element;
    this.render();
  }

  private render(): void {
    if (!this.element) return;
    if (this.stream?.track !== this.track) {
      this.stream = this.track ? { track: this.track, media: new MediaStream([this.track]) } : null;
    }
    const media = this.stream?.media ?? null;
    if (this.element.srcObject !== media) this.element.srcObject = media;
  }
}
