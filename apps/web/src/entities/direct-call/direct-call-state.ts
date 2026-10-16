import type { CallConnectionQuality, DirectCallView } from "@voreli/shared";

import { type CallCameraStatus, directCallIdle, useDirectCall } from "./direct-call.store";

/**
 * The only place that writes the direct-call store.
 *
 * The call session and the camera used to share a generic `replace(Partial)`, which let
 * each of them write any field — including the other's. Named transitions keep every write
 * visible by name, and the camera pieces see this object only through their narrow ports,
 * so a camera bug cannot touch the call status and the reverse. It holds no fields of its
 * own: the store is the truth, read back through the getters below.
 *
 * The camera ports are declared by their consumers in features/call-camera, which an entity
 * must not import; they are checked structurally where `CallCamera` hands this object over.
 */
export class DirectCallState {
  get call(): DirectCallView | null {
    return useDirectCall.getState().call;
  }

  get mediaRoomId(): string | null {
    return useDirectCall.getState().mediaRoomId;
  }

  get cameraStatus(): CallCameraStatus {
    return useDirectCall.getState().cameraStatus;
  }

  /** Ringing either way: the call exists but has no media room yet. */
  pending(call: DirectCallView): void {
    useDirectCall.setState({ call, mediaRoomId: null, error: null });
  }

  /** The server accepted our start; the media room, if any, is untouched until it answers. */
  placed(call: DirectCallView): void {
    useDirectCall.setState({ call, error: null });
  }

  activated(call: DirectCallView, mediaRoomId: string): void {
    useDirectCall.setState({ call, mediaRoomId, error: null });
  }

  qualityChanged(quality: CallConnectionQuality): void {
    useDirectCall.setState({ quality });
  }

  peerReconnecting(userId: string | null): void {
    useDirectCall.setState({ reconnectingUserId: userId });
  }

  clearError(): void {
    useDirectCall.setState({ error: null });
  }

  failed(message: string): void {
    useDirectCall.setState({ error: message });
  }

  reset(): void {
    useDirectCall.setState(directCallIdle);
  }

  /** A call ended for good: history readers learn which conversation to refresh. */
  completed(conversationId: string): void {
    useDirectCall.setState((state) => ({
      ...directCallIdle,
      historyRevision: state.historyRevision + 1,
      lastEndedConversationId: conversationId,
    }));
  }

  cameraStarting(): void {
    useDirectCall.setState({ cameraStatus: "starting", cameraError: null });
  }

  cameraOn(): void {
    useDirectCall.setState({ cameraStatus: "on" });
  }

  cameraFailed(message: string, status: "on" | "error" = "error"): void {
    useDirectCall.setState({ cameraStatus: status, cameraError: message });
  }

  /** Turned off on purpose: whatever went wrong before no longer matters. */
  cameraOff(): void {
    useDirectCall.setState({
      cameraStatus: "off",
      cameraError: null,
      cameraSwitchAvailable: false,
      cameraNetworkPaused: false,
    });
  }

  /** Closed underneath us; an earlier camera error stays on screen as the likely reason. */
  cameraEnded(): void {
    useDirectCall.setState({
      cameraStatus: "off",
      cameraSwitchAvailable: false,
      cameraNetworkPaused: false,
    });
  }

  cameraSwitchAvailable(available: boolean): void {
    useDirectCall.setState({ cameraSwitchAvailable: available });
  }

  cameraNetworkPaused(paused: boolean): void {
    useDirectCall.setState({ cameraNetworkPaused: paused });
  }

  remoteCamera(on: boolean): void {
    useDirectCall.setState({ remoteCameraOn: on });
  }
}
