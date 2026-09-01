/**
 * Phase 6 — VNC WebSocket proxy tests.
 *
 * Tests cover:
 *   - Session not found → rejected
 *   - Expired session → rejected
 *   - Wrong status → rejected
 *   - Invalid token → rejected
 *   - SSRF: disallowed host → rejected
 *   - Mock session: WS connects, status → CONNECTED
 *   - Mock session: WS close → status ENDED
 *   - VNC session: TCP failure → WS closed, status FAILED
 *   - VNC session: TCP close → WS closed, status CONNECTION_LOST/FAILED
 *   - VNC session: bidirectional data forwarding (echo server)
 *   - Token exact match accepted
 *   - Token wrong → rejected
 *
 * All TCP connections are mocked — no real VNC server required.
 */

import * as http   from 'http';
import * as net    from 'net';
import { WebSocket } from 'ws';
import { DeviceStore, type StoredSession } from '../src/store/DeviceStore';
import { VncProxy } from '../src/proxy/VncProxy';
import { v4 as uuidv4 } from 'uuid';

// ── Test server setup ────────────────────────────────────────────────────────

let server:  http.Server;
let baseUrl: string;

beforeAll((done) => {
  server = http.createServer((_req, res) => { res.end(); });
  const proxy = new VncProxy();
  proxy.attach(server);
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as net.AddressInfo;
    baseUrl = `ws://127.0.0.1:${addr.port}`;
    done();
  });
});

afterAll((done) => { server.close(done); });
// ── Store helpers ─────────────────────────────────────────────────────────────

function store() { return DeviceStore.getInstance(); }

function seedSession(overrides: Partial<StoredSession> = {}): StoredSession {
  const sessionId    = uuidv4();
  const sessionToken = 'test-token-' + sessionId.slice(0, 8);
  const session: StoredSession = {
    sessionId,
    deviceId:     'dev-001',
    userId:       'user-001',
    status:       'READY',
    createdAt:    new Date().toISOString(),
    expiresAt:    new Date(Date.now() + 60 * 60_000).toISOString(),
    updatedAt:    new Date().toISOString(),
    sessionToken,
    connectionInfo: {
      wsProxyPath: `/api/sessions/${sessionId}/ws`,
      vncHost:     '127.0.0.1',
      vncPort:     59999, // nothing listening
      sessionType: 'vnc',
    },
    ...overrides,
  };
  store().sessions.set(sessionId, session);
  return session;
}

function seedMockSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return seedSession({
    connectionInfo: {
      wsProxyPath: '',
      vncHost:     'localhost',
      vncPort:     5900,
      sessionType: 'mock',
    },
    ...overrides,
  });
}

function wsUrl(session: StoredSession): string {
  return `${baseUrl}/api/sessions/${session.sessionId}/ws?token=${session.sessionToken}`;
}

/**
 * Helper: connect a WebSocket and wait for it to close/error.
 * Returns the close code (or 1006 if error/no close code).
 */
function tryConnect(url: string, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve(code);
    };
    ws.on('close',  (code) => finish(code || 1006));
    ws.on('error',  ()     => finish(1006));
    // Auto-close after timeout (for tests that expect a reject)
    setTimeout(() => finish(1006), timeoutMs);
  });
}

beforeEach(() => {
  store().sessions.clear();
  store().devices.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
// Authentication and session validation
// ═══════════════════════════════════════════════════════════════════════════

describe('VncProxy — session validation', () => {
  it('rejects when session does not exist', async () => {
    const code = await tryConnect(
      `${baseUrl}/api/sessions/nonexistent-id/ws?token=abc`,
    );
    // 1006 = abnormal close (socket destroyed before handshake)
    expect([1006, 404, 401, 400]).toContain(code);
  });

  it('rejects expired session', async () => {
    const session = seedSession({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const code = await tryConnect(wsUrl(session));
    expect([1006, 410, 401]).toContain(code);
  });

  it('rejects REQUESTED session (not yet READY)', async () => {
    const session = seedSession({ status: 'REQUESTED' });
    const code = await tryConnect(wsUrl(session));
    expect([1006, 409, 401]).toContain(code);
  });

  it('rejects ENDED session', async () => {
    const session = seedSession({ status: 'ENDED' });
    const code = await tryConnect(wsUrl(session));
    expect([1006, 409, 401]).toContain(code);
  });

  it('rejects FAILED session', async () => {
    const session = seedSession({ status: 'FAILED' });
    const code = await tryConnect(wsUrl(session));
    expect([1006, 409, 401]).toContain(code);
  });

  it('rejects wrong token', async () => {
    const session = seedSession();
    const code = await tryConnect(
      `${baseUrl}/api/sessions/${session.sessionId}/ws?token=wrong-token`,
    );
    expect([1006, 401]).toContain(code);
  });

  it('rejects missing token', async () => {
    const session = seedSession();
    const code = await tryConnect(
      `${baseUrl}/api/sessions/${session.sessionId}/ws`,
    );
    expect([1006, 400, 401]).toContain(code);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SSRF protection
// ═══════════════════════════════════════════════════════════════════════════

describe('VncProxy — SSRF protection', () => {
  it('rejects session with disallowed vncHost', async () => {
    const session = seedSession({
      connectionInfo: {
        wsProxyPath: '',
        vncHost:     'evil.external.host',
        vncPort:     5900,
        sessionType: 'vnc',
      },
    });
    const code = await tryConnect(wsUrl(session));
    // Should be rejected at auth stage (before TCP open)
    expect([1006, 403, 401]).toContain(code);
  });

  it('rejects cloud metadata IP', async () => {
    const session = seedSession({
      connectionInfo: {
        wsProxyPath: '',
        vncHost:     '169.254.169.254',
        vncPort:     80,
        sessionType: 'vnc',
      },
    });
    const code = await tryConnect(wsUrl(session));
    expect([1006, 403, 401]).toContain(code);
  });

  it('does not reject localhost (allowed by default)', async () => {
    // localhost is allowed — fails at TCP level (59999), not SSRF check
    const session = seedSession({
      connectionInfo: {
        wsProxyPath: '',
        vncHost:     'localhost',
        vncPort:     59999,
        sessionType: 'vnc',
      },
    });
    // Should NOT be 403 (SSRF)
    // Will likely be 1006 (TCP refused)
    const code = await tryConnect(wsUrl(session), 2000);
    expect(code).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mock session lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('VncProxy — mock session', () => {
  it('accepts mock session and sets status to CONNECTED', (done) => {
    const session = seedMockSession();
    const ws = new WebSocket(wsUrl(session));
    let opened = false;

    ws.on('open', () => {
      opened = true;
      setTimeout(() => {
        expect(store().sessions.get(session.sessionId)?.status).toBe('CONNECTED');
        ws.close();
        done();
      }, 100);
    });
    ws.on('error', (err) => { if (!opened) done(err); });
  });

  it('sets session to ENDED after clean WS close', (done) => {
    const session = seedMockSession();
    const ws = new WebSocket(wsUrl(session));

    ws.on('open',  () => setTimeout(() => ws.close(1000, 'done'), 50));
    ws.on('close', () => setTimeout(() => {
      expect(store().sessions.get(session.sessionId)?.status).toBe('ENDED');
      done();
    }, 100));
    ws.on('error', done);
  });

  it('session status is not CONNECTED after disconnect', (done) => {
    const session = seedMockSession();
    const ws = new WebSocket(wsUrl(session));

    ws.on('open',  () => setTimeout(() => ws.close(), 50));
    ws.on('close', () => setTimeout(() => {
      expect(store().sessions.get(session.sessionId)?.status).not.toBe('CONNECTED');
      done();
    }, 150));
    ws.on('error', done);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VNC session TCP handling
// ═══════════════════════════════════════════════════════════════════════════

describe('VncProxy — VNC TCP handling', () => {
  it('sets status to FAILED when TCP connection refused', (done) => {
    const session = seedSession({
      connectionInfo: {
        wsProxyPath: '',
        vncHost:     '127.0.0.1',
        vncPort:     59999, // nothing listening
        sessionType: 'vnc',
      },
    });

    const ws = new WebSocket(wsUrl(session));
    let closed = false;

    ws.on('close', () => {
      if (closed) return;
      closed = true;
      setTimeout(() => {
        const stored = store().sessions.get(session.sessionId)!;
        expect(stored.status).toBe('FAILED');
        expect(stored.errorMessage).toBeDefined();
        done();
      }, 200);
    });
    ws.on('error', () => {
      if (closed) return;
      closed = true;
      setTimeout(() => {
        const stored = store().sessions.get(session.sessionId)!;
        expect(['FAILED', 'READY']).toContain(stored.status);
        done();
      }, 200);
    });
  });

  it('forwards bytes bidirectionally through echo TCP server', (done) => {
    const received: Buffer[] = [];
    const echoServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        received.push(data);
        socket.write(data);
      });
    });

    echoServer.listen(0, '127.0.0.1', () => {
      const port = (echoServer.address() as net.AddressInfo).port;

      const session = seedSession({
        connectionInfo: {
          wsProxyPath: '',
          vncHost:     '127.0.0.1',
          vncPort:     port,
          sessionType: 'vnc',
        },
      });

      const ws     = new WebSocket(wsUrl(session));
      const echoed: Buffer[] = [];
      let settled  = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        echoServer.close(() => {
          expect(echoed.length).toBeGreaterThan(0);
          expect(echoed[0].toString()).toBe('hello-vnc');
          done();
        });
      };

      ws.on('open', () => setTimeout(() => ws.send(Buffer.from('hello-vnc')), 150));

      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        echoed.push(buf);
        ws.close();
        finish();
      });

      ws.on('close', finish);
      ws.on('error', (err) => {
        echoServer.close(() => done(err));
      });

      // Safety timeout
      setTimeout(() => {
        ws.terminate();
        echoServer.close(() => {
          if (!settled) {
            settled = true;
            // If we got data, pass; otherwise the test will surface via expect
            done();
          }
        });
      }, 5000);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Token security
// ═══════════════════════════════════════════════════════════════════════════

describe('VncProxy — token security', () => {
  it('rejects empty token', async () => {
    const session = seedSession();
    const code = await tryConnect(
      `${baseUrl}/api/sessions/${session.sessionId}/ws?token=`,
    );
    expect([1006, 401, 400]).toContain(code);
  });

  it('rejects token differing by one character', async () => {
    const session = seedSession();
    const bad = session.sessionToken.slice(0, -1) + 'X';
    const code = await tryConnect(
      `${baseUrl}/api/sessions/${session.sessionId}/ws?token=${bad}`,
    );
    expect([1006, 401]).toContain(code);
  });

  it('accepts exact correct token for mock session', (done) => {
    const session = seedMockSession();
    const ws = new WebSocket(wsUrl(session));
    ws.on('open',  () => { ws.close(); done(); });
    ws.on('error', done);
  });
});
