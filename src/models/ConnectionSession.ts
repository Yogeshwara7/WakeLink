/**
 * The ordered states of a connection attempt.
 * The ConnectionService drives transitions through this sequence.
 */
export enum ConnectionStep {
  CHECKING = 'CHECKING',
  PC_OFFLINE = 'PC_OFFLINE',
  SENDING_WAKE = 'SENDING_WAKE',
  WAITING_FOR_PC = 'WAITING_FOR_PC',
  PC_ONLINE = 'PC_ONLINE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  FAILED = 'FAILED',
}

export interface ConnectionSession {
  deviceId: string;
  step: ConnectionStep;
  /** Human-readable description of the current step shown in the UI. */
  message: string;
  startedAt: string;
  errorMessage?: string;

  // ── Phase 5: Remote session fields (optional — mock flows unaffected) ─────
  /** Backend session UUID — populated once the agent reports READY. */
  sessionId?: string;
  /**
   * Short-lived auth token for the WebSocket proxy connection.
   * Passed to the session screen so it can authenticate the WebView.
   * NEVER log this value.
   */
  sessionToken?: string;
  /** WebSocket proxy path on the backend: /api/sessions/:id/ws */
  wsProxyPath?: string;
  /** Session technology reported by the agent. */
  sessionType?: 'vnc' | 'webrtc' | 'rdp' | 'mock';
}
