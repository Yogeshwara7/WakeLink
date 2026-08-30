/**
 * Phase 5 — session route integration tests.
 *
 * Covers:
 *   - POST /api/devices/:id/connect — session creation
 *   - GET  /api/sessions/:id       — session polling
 *   - POST /api/sessions/:id/agent-ready
 *   - POST /api/sessions/:id/disconnect
 *   - POST /api/sessions/:id/ended
 *   - Duplicate session rejection
 *   - Device not online rejection
 *   - Session token never in GET response
 *   - CONNECT_REQUEST command queued on connect
 *   - DISCONNECT_REQUEST command queued on disconnect
 */

import request from 'supertest';
import app from '../src/index';
import { DeviceStore, type StoredDevice } from '../src/store/DeviceStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function store() { return DeviceStore.getInstance(); }

function seedDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  const device: StoredDevice = {
    deviceId:        'sess-device-001',
    deviceName:      'Test PC',
    platform:        'windows',
    agentVersion:    '0.1.0',
    os:              'win32',
    osVersion:       'Windows_NT 10.0',
    capabilities:    { wakeOnLan: true, hardwareWake: false, remoteDesktop: false },
    status:          'ONLINE',
    lastHeartbeatAt: new Date().toISOString(),
    registeredAt:    new Date().toISOString(),
    pairedUserId:    'user-001',
    macAddress:      'AA:BB:CC:DD:EE:FF',
    wakeSupported:   true,
    wakeStatus:      'IDLE',
    relayId:         null,
    ...overrides,
  };
  store().devices.set(device.deviceId, device);
  return device;
}

beforeEach(() => {
  const s = store();
  s.devices.clear();
  s.pairing.clear();
  s.commands.clear();
  s.relays.clear();
  s.relayCommands.clear();
  s.sessions.clear();
});

afterAll(() => jest.useRealTimers());

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/devices/:deviceId/connect
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/devices/:deviceId/connect', () => {
  it('returns 404 for unknown device', async () => {
    const res = await request(app)
      .post('/api/devices/nonexistent/connect')
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 409 when device is not ONLINE', async () => {
    seedDevice({ status: 'OFFLINE' });
    const res = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEVICE_NOT_ONLINE');
  });

  it('creates session and returns sessionId + sessionToken', async () => {
    seedDevice();
    const res = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.sessionToken).toBeDefined();
    expect(res.body.status).toBe('REQUESTED');
  });

  it('stores session in REQUESTED state', async () => {
    seedDevice();
    const res = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});

    const session = store().sessions.get(res.body.sessionId);
    expect(session).toBeDefined();
    expect(session!.status).toBe('REQUESTED');
    expect(session!.deviceId).toBe('sess-device-001');
  });

  it('queues a CONNECT_REQUEST command for the agent', async () => {
    seedDevice();
    const res = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});

    const commands = Array.from(store().commands.values());
    const connectCmd = commands.find((c) => c.type === 'CONNECT_REQUEST');
    expect(connectCmd).toBeDefined();
    expect(connectCmd!.payload['sessionId']).toBe(res.body.sessionId);
    expect(connectCmd!.payload['sessionToken']).toBeDefined();
  });

  it('rejects duplicate session when one is already active', async () => {
    seedDevice();
    await request(app).post('/api/devices/sess-device-001/connect').send({});
    const res = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_ALREADY_ACTIVE');
    expect(res.body.sessionId).toBeDefined();
  });

  it('allows new session after previous one is ENDED', async () => {
    seedDevice();
    const first = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});

    // End the first session
    store().sessions.get(first.body.sessionId)!.status = 'ENDED';

    const second = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    expect(second.status).toBe(201);
    expect(second.body.sessionId).not.toBe(first.body.sessionId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sessions/:sessionId
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/sessions/:sessionId', () => {
  it('returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/sessions/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns session without exposing sessionToken', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    const res = await request(app).get(`/api/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.session.sessionId).toBe(sessionId);
    expect(res.body.session.status).toBe('REQUESTED');
    // sessionToken must NOT appear in GET response
    expect(res.body.session.sessionToken).toBeUndefined();
  });

  it('auto-expires a session past its TTL', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    // Force-expire by setting expiresAt to the past
    const session = store().sessions.get(sessionId)!;
    session.expiresAt = new Date(Date.now() - 1000).toISOString();

    const res = await request(app).get(`/api/sessions/${sessionId}`);
    expect(res.body.session.status).toBe('TIMEOUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sessions/:sessionId/agent-ready
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/sessions/:sessionId/agent-ready', () => {
  it('transitions session to READY with connectionInfo', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/agent-ready`)
      .send({
        connectionInfo: {
          wsProxyPath: `/api/sessions/${sessionId}/ws`,
          vncHost:     'localhost',
          vncPort:     5900,
          sessionType: 'mock',
        },
      });

    expect(res.status).toBe(200);
    const session = store().sessions.get(sessionId)!;
    expect(session.status).toBe('READY');
    expect(session.connectionInfo?.sessionType).toBe('mock');
    expect(session.connectionInfo?.vncPort).toBe(5900);
  });

  it('transitions session to FAILED when agent reports error', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    await request(app)
      .post(`/api/sessions/${sessionId}/agent-ready`)
      .send({ error: 'VNC server not available' });

    const session = store().sessions.get(sessionId)!;
    expect(session.status).toBe('FAILED');
    expect(session.errorMessage).toMatch(/VNC server/);
  });

  it('returns 400 when no connectionInfo or error provided', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});

    const res = await request(app)
      .post(`/api/sessions/${create.body.sessionId}/agent-ready`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sessions/:sessionId/disconnect
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/sessions/:sessionId/disconnect', () => {
  it('transitions session to DISCONNECTING and queues DISCONNECT_REQUEST', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/disconnect`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISCONNECTING');

    const disconnectCmd = Array.from(store().commands.values()).find(
      (c) => c.type === 'DISCONNECT_REQUEST',
    );
    expect(disconnectCmd).toBeDefined();
    expect(disconnectCmd!.payload['sessionId']).toBe(sessionId);
  });

  it('is idempotent for already-ended sessions', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    store().sessions.get(sessionId)!.status = 'ENDED';

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/disconnect`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already ended/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sessions/:sessionId/ended
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/sessions/:sessionId/ended', () => {
  it('transitions session to ENDED', async () => {
    seedDevice();
    const create = await request(app)
      .post('/api/devices/sess-device-001/connect')
      .send({});
    const { sessionId } = create.body;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/ended`)
      .send({});

    expect(res.status).toBe(200);
    expect(store().sessions.get(sessionId)!.status).toBe('ENDED');
  });
});
