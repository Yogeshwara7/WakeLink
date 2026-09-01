/**
 * VncProxy — WebSocket ↔ TCP transparent byte proxy for VNC sessions.
 *
 * Architecture:
 *   Mobile (noVNC WebView)
 *     │ WebSocket  ws://backend/api/sessions/:id/ws?token=<sessionToken>
 *     ▼
 *   VncProxy.handleUpgrade()    ← this file
 *     │ TCP  127.0.0.1:5900  (or WAKELINK_VNC_HOST:WAKELINK_VNC_PORT)
 *     ▼
 *   VNC Server (TightVNC / UltraVNC / RealVNC on Windows)
 *     ▼
 *   Windows Desktop
 *
 * SECURITY MODEL:
 *   1. Session must exist, not expired, in READY or CONNECTED state.
 *   2. Token validated with timing-safe comparison (crypto.timingSafeEqual).
 *   3. VNC host/port come from session.connectionInfo (agent-reported),
 *      NOT from the client request — prevents SSRF.
 *   4. WAKELINK_VNC_ALLOWED_HOSTS limits which hosts the proxy may connect to.
 *   5. sessionToken is never logged.
 *
 * IMPORTANT:
 *   This is a transparent byte proxy — it does NOT parse the VNC protocol.
 *   noVNC handles VNC authentication (password exchange) directly with the
 *   VNC server through the forwarded byte stream.
 *   The VNC password never passes through WakeLink application code.
 */

import * as net    from 'net';
import * as crypto from 'crypto';
import * as http   from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Duplex } from 'stream';
import { DeviceStore } from '../store/DeviceStore';

// ── Configuration ─────────────────────────────────────────────────────────

/**
 * Hosts the proxy is permitted to connect to.
 * Prevents SSRF: client-controlled data can never redirect the proxy
 * to internal services, cloud metadata endpoints, etc.
 *
 * Change via WAKELINK_VNC_ALLOWED_HOSTS (comma-separated).
 * Default: localhost and loopback only.
 */
function getAllowedHosts(): string[] {
  const env = process.env['WAKELINK_VNC_ALLOWED_HOSTS'];
  if (env) return env.split(',').map((h) => h.trim().toLowerCase());
  return ['localhost', '127.0.0.1', '::1'];
}

// ── URL parsing ────────────────────────────────────────────────────────────

/**
 * Extracts sessionId and token from the upgrade URL.
 * Expected path: /api/sessions/<sessionId>/ws
 * Expected query: ?token=<sessionToken>
 */
function parseUpgradeUrl(url: string): {
  sessionId: string | null;
  token: string | null;
} {
  try {
    // url is a path like /api/sessions/abc-123/ws?token=xyz
    const parsed  = new URL(url, 'http://localhost');
    const parts   = parsed.pathname.split('/');
    // /api/sessions/<sessionId>/ws  →  ['', 'api', 'sessions', id, 'ws']
    const sessionId = parts[3] ?? null;
    const token     = parsed.searchParams.get('token');
    return { sessionId, token };
  } catch {
    return { sessionId: null, token: null };
  }
}

// ── Token validation ───────────────────────────────────────────────────────

/**
 * Timing-safe token comparison.
 * Prevents timing side-channel attacks that could leak token bytes.
 */
function validateToken(submitted: string, stored: string): boolean {
  // Ensure both buffers are the same length before comparing
  // (timingSafeEqual throws if lengths differ)
  const a = Buffer.from(submitted, 'utf-8');
  const b = Buffer.from(stored,    'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── VncProxy class ─────────────────────────────────────────────────────────

export class VncProxy {
  private readonly wss:   WebSocketServer;
  private readonly store: DeviceStore;

  constructor() {
    this.store = DeviceStore.getInstance();
    // noServer mode: we handle the upgrade event manually so we can
    // perform auth before completing the WebSocket handshake.
    this.wss   = new WebSocketServer({ noServer: true });
  }

  /**
   * Attach this proxy to an existing http.Server.
   * The server's 'upgrade' event is routed here for session WS paths.
   *
   * Call this once from server startup:
   *   const proxy = new VncProxy();
   *   proxy.attach(httpServer);
   */
  attach(server: http.Server): void {
    server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? '';
      // Only handle WebSocket upgrades on our proxy path
      if (!url.includes('/api/sessions/') || !url.endsWith('/ws') && !url.includes('/ws?')) {
        socket.destroy();
        return;
      }
      this.handleUpgrade(req, socket as net.Socket, head);
    });
    console.log('[VncProxy] Attached to HTTP server — WebSocket proxy active');
  }

  // ── Upgrade handler ──────────────────────────────────────────────────────

  private handleUpgrade(
    req:    http.IncomingMessage,
    socket: net.Socket,
    head:   Buffer,
  ): void {
    const url = req.url ?? '';
    const { sessionId, token } = parseUpgradeUrl(url);

    // ── Validate session ────────────────────────────────────────────────
    const rejection = this.validateSession(sessionId, token);
    if (rejection) {
      console.warn(`[VncProxy] Rejected WS upgrade (${sessionId}): ${rejection.message}`);
      socket.write(
        `HTTP/1.1 ${rejection.httpStatus} ${rejection.message}\r\n\r\n`,
      );
      socket.destroy();
      return;
    }

    const session = this.store.sessions.get(sessionId!)!;

    // Complete the WebSocket handshake
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
      this.openProxyConnection(ws, session.sessionId);
    });
  }

  // ── Session validation ───────────────────────────────────────────────────

  private validateSession(
    sessionId: string | null,
    token: string | null,
  ): { message: string; httpStatus: number } | null {
    if (!sessionId || !token) {
      return { message: 'Bad Request — missing sessionId or token', httpStatus: 400 };
    }

    const session = this.store.sessions.get(sessionId);
    if (!session) {
      return { message: 'Not Found — session does not exist', httpStatus: 404 };
    }

    // Auto-expire
    if (Date.now() > new Date(session.expiresAt).getTime()) {
      session.status    = 'TIMEOUT';
      session.updatedAt = new Date().toISOString();
      return { message: 'Gone — session has expired', httpStatus: 410 };
    }

    const allowedStatuses: string[] = ['READY', 'CONNECTED'];
    if (!allowedStatuses.includes(session.status)) {
      return {
        message: `Conflict — session status is ${session.status}, expected READY or CONNECTED`,
        httpStatus: 409,
      };
    }

    if (!validateToken(token, session.sessionToken)) {
      return { message: 'Unauthorized — invalid session token', httpStatus: 401 };
    }

    if (!session.connectionInfo) {
      return { message: 'Service Unavailable — no VNC connection info', httpStatus: 503 };
    }

    if (session.connectionInfo.sessionType === 'mock') {
      // Mock sessions: WebSocket opens successfully but no real TCP target
      return null;
    }

    // SSRF protection: verify the host is in the allowed list
    const host = session.connectionInfo.vncHost.toLowerCase();
    if (!getAllowedHosts().includes(host)) {
      console.error(
        `[VncProxy] SSRF attempt blocked — host "${host}" not in allowed list`,
      );
      return { message: 'Forbidden — VNC host not permitted', httpStatus: 403 };
    }

    return null; // all checks passed
  }

  // ── Proxy connection ─────────────────────────────────────────────────────

  private openProxyConnection(ws: WebSocket, sessionId: string): void {
    const session = this.store.sessions.get(sessionId);
    if (!session?.connectionInfo) {
      // Mock session — acknowledge connection but no TCP
      if (session?.connectionInfo === undefined && session?.status === 'READY') {
        this.handleMockSession(ws, session);
        return;
      }
      ws.close(1011, 'No connection info');
      return;
    }

    const { vncHost, vncPort, sessionType } = session.connectionInfo;

    if (sessionType === 'mock') {
      this.handleMockSession(ws, session);
      return;
    }

    console.log(`[VncProxy] Opening TCP → ${vncHost}:${vncPort} for session ${sessionId}`);

    const tcpSocket = new net.Socket();

    // ── Connect TCP ────────────────────────────────────────────────────
    tcpSocket.connect(vncPort, vncHost, () => {
      console.log(`[VncProxy] TCP connected → ${vncHost}:${vncPort} (session ${sessionId})`);
      session.status    = 'CONNECTED';
      session.updatedAt = new Date().toISOString();
    });

    // ── WS → TCP ───────────────────────────────────────────────────────
    ws.on('message', (data: Buffer | string) => {
      if (tcpSocket.writable) {
        tcpSocket.write(
          Buffer.isBuffer(data) ? data : Buffer.from(data as string),
        );
      }
    });

    // ── TCP → WS ───────────────────────────────────────────────────────
    tcpSocket.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // ── TCP error ──────────────────────────────────────────────────────
    tcpSocket.on('error', (err) => {
      console.error(`[VncProxy] TCP error for session ${sessionId}:`, err.message);
      session.status       = 'FAILED';
      session.errorMessage = `VNC TCP error: ${err.message}`;
      session.updatedAt    = new Date().toISOString();
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'VNC connection error');
      }
    });

    // ── TCP close ──────────────────────────────────────────────────────
    tcpSocket.on('close', () => {
      console.log(`[VncProxy] TCP closed for session ${sessionId}`);
      if (session.status === 'CONNECTED') {
        session.status    = 'CONNECTION_LOST';
        session.updatedAt = new Date().toISOString();
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'VNC connection closed');
      }
    });

    // ── WS close ───────────────────────────────────────────────────────
    ws.on('close', (code, reason) => {
      console.log(
        `[VncProxy] WS closed for session ${sessionId} ` +
        `(code=${code} reason=${reason?.toString()})`,
      );
      if (!['ENDED', 'FAILED'].includes(session.status)) {
        session.status    = 'ENDED';
        session.updatedAt = new Date().toISOString();
      }
      if (!tcpSocket.destroyed) {
        tcpSocket.destroy();
      }
    });

    // ── WS error ───────────────────────────────────────────────────────
    ws.on('error', (err) => {
      console.warn(`[VncProxy] WS error for session ${sessionId}:`, err.message);
      if (!tcpSocket.destroyed) tcpSocket.destroy();
    });

    // ── TCP connect failure ────────────────────────────────────────────
    tcpSocket.on('error', (err) => {
      console.error(`[VncProxy] TCP connect failed for session ${sessionId}: ${err.message}`);
      session.status       = 'FAILED';
      session.errorMessage = `Cannot reach VNC server: ${err.message}`;
      session.updatedAt    = new Date().toISOString();
      ws.close(1011, 'VNC server unreachable');
    });
  }

  // ── Mock session handler ─────────────────────────────────────────────────

  /**
   * For mock sessions: WebSocket connects successfully but no real VNC.
   * Sends a short greeting so noVNC doesn't immediately time out.
   * Used in tests and development without a VNC server.
   */
  private handleMockSession(
    ws:      WebSocket,
    session: { sessionId: string; status: string; updatedAt: string },
  ): void {
    console.log(`[VncProxy] Mock session connected: ${session.sessionId}`);
    session.status    = 'CONNECTED';
    session.updatedAt = new Date().toISOString();

    ws.on('close', () => {
      session.status    = 'ENDED';
      session.updatedAt = new Date().toISOString();
    });
    ws.on('error', () => {
      if (!['ENDED', 'FAILED'].includes(session.status)) {
        session.status    = 'ENDED';
        session.updatedAt = new Date().toISOString();
      }
    });
  }

  /** Expose internal WSS for testing. */
  getWss(): WebSocketServer { return this.wss; }

  /** Close the WebSocketServer (call in test teardown). */
  close(): void { this.wss.close(); }
}
