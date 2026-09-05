import {
  type CreateProducerResponse,
  type CreateTransportResponse,
  type RestartIceResponse,
  VoiceClientEvent,
} from "@voreli/shared";
import type { types } from "mediasoup-client";

import type { VoiceSignaling } from "./voice-signaling";

export interface VoiceTransports {
  readonly send: types.Transport;
  readonly recv: types.Transport;
}

/**
 * Creates the send/recv transport pair and wires it to the signaling channel.
 *
 * Two transports rather than one because mediasoup separates the directions: a send transport
 * carries producers, a recv transport carries consumers, and each negotiates its own DTLS.
 * They are created in parallel — neither depends on the other's answer.
 */
export async function createVoiceTransports(
  device: types.Device,
  signaling: VoiceSignaling,
  onError: (error: unknown) => void,
): Promise<VoiceTransports> {
  const [sendOptions, recvOptions] = await Promise.all([
    signaling.request<CreateTransportResponse>(VoiceClientEvent.CreateTransport, {
      direction: "send",
    }),
    signaling.request<CreateTransportResponse>(VoiceClientEvent.CreateTransport, {
      direction: "recv",
    }),
  ]);

  // The shared contract types candidates as readonly; mediasoup-client wants a mutable array.
  const send = device.createSendTransport({
    ...sendOptions,
    iceCandidates: [...sendOptions.iceCandidates],
  });
  const recv = device.createRecvTransport({
    ...recvOptions,
    iceCandidates: [...recvOptions.iceCandidates],
  });

  bindSignaling(send, signaling, onError);
  bindSignaling(recv, signaling, onError);
  bindProducing(send, signaling);

  return { send, recv };
}

/**
 * mediasoup-client raises "connect" as a question only the server can answer, so a transport
 * stays inert until something translates it into a voice event. It is asked once per
 * transport — the DTLS handshake does not repeat.
 */
function bindSignaling(
  transport: types.Transport,
  signaling: VoiceSignaling,
  onError: (error: unknown) => void,
): void {
  transport.on("connect", ({ dtlsParameters }, accept, reject) => {
    void signaling
      .request<null>(VoiceClientEvent.ConnectTransport, {
        transportId: transport.id,
        dtlsParameters,
      })
      .then(() => accept(), reject);
  });

  // "disconnected" is usually a changed network path, not a lost peer: new ICE credentials
  // let the same transport re-probe instead of tearing the whole session down.
  transport.on("connectionstatechange", (state) => {
    if (state === "disconnected" || state === "failed") {
      void restartIce(transport, signaling).catch(onError);
    }
  });
}

/** Only a send transport produces, which is why this is not part of the shared binding. */
function bindProducing(transport: types.Transport, signaling: VoiceSignaling): void {
  transport.on("produce", ({ kind, rtpParameters }, accept, reject) => {
    void signaling
      .request<CreateProducerResponse>(VoiceClientEvent.CreateProducer, {
        transportId: transport.id,
        kind,
        rtpParameters,
      })
      .then(({ producerId }) => accept({ id: producerId }), reject);
  });
}

async function restartIce(transport: types.Transport, signaling: VoiceSignaling): Promise<void> {
  const response = await signaling.request<RestartIceResponse>(VoiceClientEvent.RestartIce, {
    transportId: transport.id,
  });
  await transport.restartIce(response);
}
