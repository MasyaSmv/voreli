export interface TransportFailureObserver {
  transportFailed(sessionId: string): Promise<void> | void;
  transportReconnectChanged(sessionId: string, reconnecting: boolean): Promise<void> | void;
}
