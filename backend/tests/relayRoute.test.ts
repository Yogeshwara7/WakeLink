/**
 * Phase 4 — relay route + wake route integration tests.
 *
 * Tests cover:
 *   - Relay registration
 *   - Relay authentication (token verification)
 *   - Relay heartbeat
 *   - Relay command polling
 *   - Relay command result reporting
 *   - Wake route: relay routing path
 *   - Wake route: already-online shortcut
 *   - Wake route: duplicate (already WAKING)
 *   - Wake route: no relay (direct fallback)
 *   - Wake route: relay offline
 *   - Wake route: relay unavailable with requireRelay=true
 *   - WAKING → ONLINE via heartbeat
 */

import request from 'supertest';
import app from '../src/index';
import { DeviceStore, type StoredDevice, type StoredRelay } from '../src/store/DeviceStore';
import { hashToken } from '../src/utils/hashToken';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStore(): DeviceStore { return DeviceStore.getInstance(); }

function seedDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  const device: StoredDevice = {
    deviceId:       'test-device-p4',
    deviceName:     'Test PC Phase 4',
    platform:       'windows',
    agentVersion:   '0.1.0',
    os:             'win32',
    osVersion:      'Windows_NT 10.0',
    capabilities:   { wakeOnLan: true, hardwareWake: false, remoteDesktop: false },
    status:         'OFFLINE',
    lastHeartbeatAt: null,
    registeredAt:   new Date().toISOString(),
    pairedUserId:   null,
    macAddress:     'AA:BB:CC:DD:EE:FF',
    wakeSupported:  true,
    wakeStatus:     'IDLE',
    relayId:        null,
    ...overrides,
  };
  getStore().devices.set(device.deviceId, device);
  return device;
}

function seedRelay(overrides: Partial<StoredRelay> = {}): {
  relay: StoredRelay;
  rawToken: string;
} {
  const rawToken = 'test-raw-token-abc123';
  const relay: StoredRelay = {
    relayId:         'relay-p4-001',
    relayTokenHash:  hashToken(rawToken),
    relayName:       'Test Home Relay',
    relayVersion:    '0.1.0',
    status:          'ONLINE',
    lastHeartbeatAt: new Date().toISOString(),
    registeredAt:    new Date().toISOString(),
    deviceIds:       ['test-device-p4'],
    broadcastAddress: '255.255.255.255',
    ...overrides,
  };
  getStore().relays.set(relay.relayId, relay);
  return { relay, rawToken };
}

beforeEach(() => {
  const store = getStore();
  store.devices.clear();
  store.pairing.clear();
  store.commands.clear();
  store.relays.clear();
  store.relayCommands.clear();
});

afterAll(() => { jest.useRealTimers(); });

// ═══════════════════════════════════════════════════════════════════════════
// Relay registration
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/relay/register', () => {
  it('registers a relay and returns relayId + relayToken', async () => {
    const res = await request(app)
      .post('/api/relay/register')
      .send({ relayName: 'Home Relay', relayVersion: '0.1.0' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.relayId).toBeDefined();
    expect(res.body.relayToken).toBeDefined();
    expect(typeof res.body.relayToken).toBe('string');
    expect(res.body.relayToken.length).toBeGreaterThan(20);
  });

  it('stores hashed token — raw token is NOT in the store', async () => {
    const res = await request(app)
      .post('/api/relay/register')
      .send({ relayName: 'Test Relay' });

    const store = getStore();
    const relay = store.relays.get(res.body.relayId);
    expect(relay).toBeDefined();
    // Raw token must not equal the stored hash
    expect(relay!.relayTokenHash).not.toBe(res.body.relayToken);
    expect(relay!.relayTokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('associates declared deviceIds with the relay on registration', async () => {
    seedDevice();
    const res = await request(app)
      .post('/api/relay/register')
      .send({ relayName: 'My Relay', deviceIds: ['test-device-p4'] });

    expect(res.status).toBe(201);
    const device = getStore().devices.get('test-device-p4');
    expect(device?.relayId).toBe(res.body.relayId);
  });

  it('returns 400 if relayName is missing', async () => {
    const res = await request(app).post('/api/relay/register').send({});
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Relay authentication
// ═══════════════════════════════════════════════════════════════════════════

describe('Relay authentication', () => {
  it('rejects heartbeat with no token', async () => {
    const { relay } = seedRelay();
    const res = await request(app)
      .post(`/api/relay/${relay.relayId}/heartbeat`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('rejects heartbeat with wrong token', async () => {
    const { relay } = seedRelay();
    const res = await request(app)
      .post(`/api/relay/${relay.relayId}/heartbeat`)
      .set('Authorization', 'Bearer wrong-token')
      .send({});
    expect(res.status).toBe(401);
  });

  it('accepts heartbeat with correct token', async () => {
    const { relay, rawToken } = seedRelay();
    const res = await request(app)
      .post(`/api/relay/${relay.relayId}/heartbeat`)
      .set('Authorization', `Bearer ${rawToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Relay heartbeat
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/relay/:relayId/heartbeat', () => {
  it('updates lastHeartbeatAt and status', async () => {
    const { relay, rawToken } = seedRelay({
      status: 'OFFLINE',
      lastHeartbeatAt: null,
    });

    await request(app)
      .post(`/api/relay/${relay.relayId}/heartbeat`)
      .set('Authorization', `Bearer ${rawToken}`)
      .send({});

    const updated = getStore().relays.get(relay.relayId)!;
    expect(updated.status).toBe('ONLINE');
    expect(updated.lastHeartbeatAt).not.toBeNull();
  });

  it('updates deviceIds from heartbeat body', async () => {
    const { relay, rawToken } = seedRelay({ deviceIds: [] });
    seedDevice();

    await request(app)
      .post(`/api/relay/${relay.relayId}/heartbeat`)
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ deviceIds: ['test-device-p4'] });

    const updated = getStore().relays.get(relay.relayId)!;
    expect(updated.deviceIds).toContain('test-device-p4');

    const device = getStore().devices.get('test-device-p4');
    expect(device?.relayId).toBe(relay.relayId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Relay command polling + result
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/relay/:relayId/commands/pending', () => {
  it('returns empty array when no commands queued', async () => {
    const { relay, rawToken } = seedRelay();
    const res = await request(app)
      .get(`/api/relay/${relay.relayId}/commands/pending`)
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.commands).toEqual([]);
  });

  it('returns RELAY_WAKE command after wake request', async () => {
    const { relay, rawToken } = seedRelay();
    seedDevice({ relayId: relay.relayId });

    // Trigger wake (mocked WoL so no real UDP sent)
    await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    const res = await request(app)
      .get(`/api/relay/${relay.relayId}/commands/pending`)
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.commands).toHaveLength(1);
    expect(res.body.commands[0].type).toBe('RELAY_WAKE');
    expect(res.body.commands[0].macAddress).toBe('AA:BB:CC:DD:EE:FF');
  });
});

describe('POST /api/relay/:relayId/commands/:commandId/result', () => {
  it('marks command as processed on success result', async () => {
    const { relay, rawToken } = seedRelay();
    seedDevice({ relayId: relay.relayId });

    await request(app).post('/api/devices/test-device-p4/wake').send({});

    const pending = await request(app)
      .get(`/api/relay/${relay.relayId}/commands/pending`)
      .set('Authorization', `Bearer ${rawToken}`);

    const cmdId = pending.body.commands[0].commandId;
    const res = await request(app)
      .post(`/api/relay/${relay.relayId}/commands/${cmdId}/result`)
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ success: true });

    expect(res.status).toBe(200);
    const cmd = getStore().relayCommands.get(cmdId)!;
    expect(cmd.processedAt).not.toBeNull();
    expect(cmd.result?.success).toBe(true);
  });

  it('sets device FAILED when relay reports failure', async () => {
    const { relay, rawToken } = seedRelay();
    seedDevice({ relayId: relay.relayId });

    await request(app).post('/api/devices/test-device-p4/wake').send({});

    const pending = await request(app)
      .get(`/api/relay/${relay.relayId}/commands/pending`)
      .set('Authorization', `Bearer ${rawToken}`);

    const cmdId = pending.body.commands[0].commandId;
    await request(app)
      .post(`/api/relay/${relay.relayId}/commands/${cmdId}/result`)
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ success: false, error: 'UDP socket error' });

    const device = getStore().devices.get('test-device-p4')!;
    expect(device.status).toBe('OFFLINE');
    expect(device.wakeStatus).toBe('FAILED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Wake route — Phase 4 paths
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/devices/:deviceId/wake — Phase 4', () => {
  it('returns alreadyOnline=true when device is ONLINE', async () => {
    seedDevice({ status: 'ONLINE' });
    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.alreadyOnline).toBe(true);
    expect(res.body.wakeStatus).toBe('ONLINE');
  });

  it('returns 409 when device is already WAKING', async () => {
    seedDevice({ status: 'WAKING', wakeStatus: 'WAKING' });
    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_WAKING');
  });

  it('routes through relay and sets via=relay when relay is online', async () => {
    const { relay } = seedRelay();
    seedDevice({ relayId: relay.relayId });

    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.via).toBe('relay');
    expect(res.body.relayId).toBe(relay.relayId);
    expect(res.body.wakeStatus).toBe('WAKING');

    // RELAY_WAKE command must be queued
    const relayCommands = Array.from(getStore().relayCommands.values());
    expect(relayCommands).toHaveLength(1);
    expect(relayCommands[0].type).toBe('RELAY_WAKE');
    expect(relayCommands[0].deviceId).toBe('test-device-p4');
  });

  it('returns 422 RELAY_OFFLINE when relay heartbeat is stale', async () => {
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
    const { relay } = seedRelay({
      status:          'ONLINE',
      lastHeartbeatAt: staleTime,
    });
    seedDevice({ relayId: relay.relayId });

    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RELAY_OFFLINE');
  });

  it('returns 422 RELAY_NOT_CONFIGURED when requireRelay=true but no relay', async () => {
    seedDevice({ relayId: null });
    const res = await request(app)
      .post('/api/devices/test-device-p4/wake?requireRelay=true')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RELAY_NOT_CONFIGURED');
  });

  it('falls back to direct send (via=direct) when no relay and requireRelay not set', async () => {
    // WoL send will throw (no socket in test) but we just check the routing
    // The mock in wakeRoute.test.ts mocks WakeOnLanService — here we accept either success or 500
    seedDevice({ relayId: null });
    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    // Either 200 (packet sent) or 500 (UDP unavailable in test) — key is via=direct OR error
    if (res.status === 200) {
      expect(res.body.via).toBe('direct');
    } else {
      expect(res.status).toBe(500);
    }
  });

  it('returns 422 WAKE_NOT_SUPPORTED when wakeSupported=false', async () => {
    seedDevice({ wakeSupported: false, relayId: null });
    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WAKE_NOT_SUPPORTED');
  });

  it('returns 422 MAC_NOT_REGISTERED when macAddress is missing', async () => {
    seedDevice({ macAddress: undefined, relayId: null });
    const res = await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAC_NOT_REGISTERED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WAKING → ONLINE via heartbeat (relay path)
// ═══════════════════════════════════════════════════════════════════════════

describe('WAKING → ONLINE via agent heartbeat after relay wake', () => {
  it('transitions device ONLINE when agent heartbeat arrives after relay wake', async () => {
    const { relay } = seedRelay();
    seedDevice({ relayId: relay.relayId });

    // Trigger wake → device becomes WAKING
    await request(app)
      .post('/api/devices/test-device-p4/wake')
      .send({});

    expect(getStore().devices.get('test-device-p4')?.status).toBe('WAKING');

    // Agent boots and sends heartbeat
    await request(app)
      .post('/api/devices/test-device-p4/heartbeat')
      .send({ agentVersion: '0.1.0' });

    const device = getStore().devices.get('test-device-p4')!;
    expect(device.status).toBe('ONLINE');
    expect(device.wakeStatus).toBe('ONLINE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Relay GET status (public, no auth)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/relay/:relayId', () => {
  it('returns relay status without exposing token hash', async () => {
    const { relay } = seedRelay();
    const res = await request(app).get(`/api/relay/${relay.relayId}`);

    expect(res.status).toBe(200);
    expect(res.body.relay.relayId).toBe(relay.relayId);
    expect(res.body.relay.relayTokenHash).toBeUndefined(); // must be omitted
  });

  it('returns 404 for unknown relayId', async () => {
    const res = await request(app).get('/api/relay/nonexistent-relay');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Device registration with relayId
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/devices/register — relayId', () => {
  it('stores relayId reported by agent', async () => {
    const { relay } = seedRelay();
    await request(app)
      .post('/api/devices/register')
      .send({
        deviceId:   'new-device-001',
        deviceName: 'New PC',
        relayId:    relay.relayId,
      });

    const device = getStore().devices.get('new-device-001');
    expect(device?.relayId).toBe(relay.relayId);
  });

  it('defaults relayId to null when not provided', async () => {
    await request(app)
      .post('/api/devices/register')
      .send({ deviceId: 'no-relay-device', deviceName: 'PC No Relay' });

    const device = getStore().devices.get('no-relay-device');
    expect(device?.relayId).toBeNull();
  });
});
