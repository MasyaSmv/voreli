import { Injectable } from "@nestjs/common";
import type { VoiceMediaSource } from "@voreli/shared";
import type { types } from "mediasoup";

import { VoiceMediaObjectLimitError } from "./errors/voice-media-errors.js";

@Injectable()
export class ProducerAdmissionPolicy {
  sourceKey(
    producers: ReadonlyMap<string, types.Producer>,
    pending: ReadonlySet<string>,
    kind: types.MediaKind,
    source: VoiceMediaSource,
    screenStreamId: string | null,
  ): string {
    const validSource =
      (source === "microphone" && kind === "audio" && screenStreamId === null) ||
      (source === "camera-video" && kind === "video" && screenStreamId === null) ||
      (source === "screen-video" && kind === "video" && screenStreamId !== null) ||
      (source === "screen-audio" && kind === "audio" && screenStreamId !== null);
    const duplicateSource = [...producers.values()].some(
      (current) =>
        current.appData["source"] === source &&
        (source === "microphone" ||
          source === "camera-video" ||
          current.appData["screenStreamId"] === screenStreamId),
    );
    const sourceKey = `${source}:${screenStreamId ?? ""}`;
    if (
      producers.size + pending.size >= 4 ||
      !validSource ||
      duplicateSource ||
      pending.has(sourceKey)
    ) {
      throw new VoiceMediaObjectLimitError("producer");
    }
    return sourceKey;
  }
}
