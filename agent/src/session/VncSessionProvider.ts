import * as net  from 'net';
import type {
  RemoteSessionProvider,
  SessionStartOptions,
  SessionInfo,
} from './RemoteSessionProvider';
import { Logger } from '../utils/Logger';

/**
 * VncSessionProvider — production session provider using a local VNC server.
 *
 * REQUIREMENTS (user must install separately — one-time setup):
 *   - A VNC server running on this Windows PC, e.g.:
 *       TightVNC:  https://www.tightvnc.com/
 *       UltraVNC:  https://uvnc.com/
 *       RealVNC:   https://www.realvnc.com/
 *   - VNC server listening on WAKELINK_VNC_PORT (default: 5900)
 *   - VNC password set and stored separately — NOT in this file
 *
 * What this provider does:
 *   1. Verifies the local VNC port is reachable (TCP connect probe).
 *   2. Reports SessionInfo back so the backend can proxy VNC→WebSocket.
 *   3. The actual VNC server process is managed independently (not started here).
 *
 * The backend's WebSocket proxy (future implementation) bridges:
 *   Mobile WebView (noVNC) ←WS→ Backend ←TCP→ Agent's VNC server (this PC)
 *
 * Activate by setting WAKELINK_SESSION_PROVIDER=vnc in agent/.env
 * and ensuring a VNC server is installed and running.
 *
 * SECURITY:
 *   - VNC is never exposed to the public internet.
 *   - All access goes through the WakeLink backend WebSocket proxy.
 *   - The backend only allows connections with a valid sessionToken.
 *   - VNC password is an additional layer of protection.
 */
export class VncSessionProvider implements RemoteSessionProvider {
  private readonly log     = Logger.getInstance();
  private readonly active  = new Map<string, SessionInfo>();
  private readonly vncHost: string;
  private readonly vncPort: number;

  constructor() {
    this.vncHost = process.env['WAKELINK_VNC_HOST'] ?? 'localhost';
    this.vncPort = parseInt(process.env['WAKELINK_VNC_PORT'] ?? '5900', 10);
  }

  async startSession(options: SessionStartOptions): Promise<SessionInfo> {
    this.log.info(
      `[VncSession] Starting VNC session ${options.sessionId} ` +
      `(${this.vncHost}:${this.vncPort})`,
    );

    // Probe that VNC is actually reachable before reporting READY
    const reachable = await this.probePort(this.vncHost, this.vncPort);
    if (!reachable) {
      throw new Error(
        `VNC server not reachable at ${this.vncHost}:${this.vncPort}. ` +
        `Ensure a VNC server (TightVNC / UltraVNC / RealVNC) is installed ` +
        `and running on this PC, then set WAKELINK_SESSION_PROVIDER=vnc.`,
      );
    }

    const info: SessionInfo = {
      sessionId:   options.sessionId,
      wsProxyPath: `/api/sessions/${options.sessionId}/ws`,
      vncHost:     this.vncHost,
      vncPort:     this.vncPort,
      sessionType: 'vnc',
    };

    this.active.set(options.sessionId, info);
    this.log.info(`[VncSession] Session ready: ${options.sessionId}`);
    return info;
  }

  async stopSession(sessionId: string): Promise<void> {
    this.log.info(`[VncSession] Session ended: ${sessionId}`);
    this.active.delete(sessionId);
    // The VNC server itself keeps running — it is not started by us.
    // If auto-stopping VNC is desired in the future, use child_process here.
  }

  isSessionActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /** TCP probe — returns true if the port is accepting connections. */
  private probePort(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer  = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });

      socket.connect(port, host);
    });
  }
}
