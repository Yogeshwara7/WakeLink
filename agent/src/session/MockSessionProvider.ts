import type {
  RemoteSessionProvider,
  SessionStartOptions,
  SessionInfo,
} from './RemoteSessionProvider';
import { Logger } from '../utils/Logger';

/**
 * MockSessionProvider — no-op session provider for development and testing.
 *
 * Does NOT start any real VNC server or network listener.
 * Returns a synthetic SessionInfo so the rest of the state machine
 * (command handling, backend reporting, mobile WebView) can be exercised
 * without requiring VNC to be installed.
 *
 * Activate by setting WAKELINK_SESSION_PROVIDER=mock in agent/.env.
 * This is the default when VNC is not configured.
 */
export class MockSessionProvider implements RemoteSessionProvider {
  private readonly log    = Logger.getInstance();
  private readonly active = new Map<string, SessionInfo>();

  async startSession(options: SessionStartOptions): Promise<SessionInfo> {
    this.log.info(`[MockSession] Starting mock session ${options.sessionId}`);

    // Simulate startup delay
    await delay(500);

    const info: SessionInfo = {
      sessionId:   options.sessionId,
      wsProxyPath: `/api/sessions/${options.sessionId}/ws`,
      vncHost:     'localhost',
      vncPort:     5900,
      sessionType: 'mock',
    };

    this.active.set(options.sessionId, info);
    this.log.info(`[MockSession] Session ready: ${options.sessionId} (mock — no real VNC)`);
    return info;
  }

  async stopSession(sessionId: string): Promise<void> {
    this.log.info(`[MockSession] Stopping session ${sessionId}`);
    this.active.delete(sessionId);
  }

  isSessionActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /** Test helper — returns the stored SessionInfo for a session. */
  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.active.get(sessionId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
