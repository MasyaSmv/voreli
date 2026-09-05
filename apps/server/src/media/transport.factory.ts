import { Injectable } from "@nestjs/common";
import type { types } from "mediasoup";

import type { VoiceRouterHandle } from "./router-registry.service.js";

@Injectable()
export class TransportFactory {
  create(handle: VoiceRouterHandle): Promise<types.WebRtcTransport> {
    return handle.router.createWebRtcTransport({
      webRtcServer: handle.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  }
}
