/**
 * RemoteSessionProvider — abstraction for the session transport layer.
 *
 * The CommandHandler calls this interface; it knows nothing about
 * whether VNC, WebRTC, RDP, or any other technology is used underneath.
 *
 * Current implementations:
 *   VncSessionProvider  — starts a local VNC server and reports the port
 *   MockSessionProvider — no-op, returns fake connection info (tests/dev)
 *
 * Future implementations (swap without touching CommandHandler):
 *   WebRtcSessionProvider — WebRTC offer/answer flow
 *   RdpTunnelProvider     — RDP over secure tunnel
 */

export interface SessionStartOptions {
  /** Backend session UUID — used to report back to the backend. */
  sessionId: string;
  /**
   * Short-lived auth token from the backend.
   * Passed to the session so the WebSocket proxy can authenticate.
   * NEVER log this value.
   */
  sessionToken: string;
  /** The backend base URL — used to POST session-ready callback. */
  backendUrl: string;
  /** Device ID of this machine. */
  deviceId: string;
}

export interface SessionInfo {
  sessionId: string;
  /** Backend WebSocket proxy path — mobile connects here. */
  wsProxyPath: string;
  /** Local VNC host (localhost on the agent side). */
  vncHost: string;
  /** Local VNC port. */
  vncPort: number;
  sessionType: 'vnc' | 'webrtc' | 'rdp' | 'mock';
}

export interface RemoteSessionProvider {
  /**
   * Start a remote session.
   * Resolves with SessionInfo when the session is ready for the mobile
   * client to connect. Rejects on failure.
   */
  startSession(options: SessionStartOptions): Promise<SessionInfo>;

  /**
   * Gracefully stop a session.
   * Should clean up any process/port/resource started by startSession.
   */
  stopSession(sessionId: string): Promise<void>;

  /**
   * Returns true if a session with the given ID is currently active.
   */
  isSessionActive(sessionId: string): boolean;
}
