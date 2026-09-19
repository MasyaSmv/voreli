export class ScreenCaptureSource {
  private stream: MediaStream | null = null;
  private generation = 0;

  async capture(): Promise<MediaStream> {
    this.stopCurrent();
    const generation = ++this.generation;
    const options: DisplayMediaStreamOptions & { systemAudio?: "include" | "exclude" } = {
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
      },
      audio: true,
      systemAudio: "include",
    };
    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Display capture was cancelled");
    }
    this.stream = stream;
    return stream;
  }

  release(): void {
    this.generation += 1;
    this.stopCurrent();
  }

  private stopCurrent(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
