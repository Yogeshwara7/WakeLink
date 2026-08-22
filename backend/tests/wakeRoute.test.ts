/**
 * Wake route integration tests.
 *
 * Uses supertest to call the Express app directly — no real UDP packets are
 * sent because WakeOnLanService.sendMagicPacket is mocked.
 */

import request from 'supertest';
import app from '../src/index';
import { DeviceStore, type StoredDevice } from '../src/store/DeviceStore';
import { WakeOnLanService } from '../src/services/WakeOnLanService';

// ── Mock the UDP send so no real packets are sent during tests ──────────────
jest.mock('../src/services/WakeOnLanService', () => {
  const actual = jest.requireActual<typeof import('../src/services/WakeOnLanService')>(
    '../src/services/WakeOnLanService',
  );

  // Extend the real class so static helpers (isValidMac, buildMagicPacket, normaliseMac)
  // remain intact while sendMagicPacket becomes a no-op.
  class MockWakeOnLanService extends actual.WakeOnLanService {
    override sendMagicPacket(_mac: string): Promise<void> {
      return Promise.resolve();
    }
  }

  return { WakeOnLanService: MockWakeOnLanService };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function seedDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  const store = DeviceStore.getInstance();
  const device: StoredDevice = {
    deviceId:       'test-device-001',
    deviceName:     'Test PC',
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
    ...overrides,
  };
  store.devices.set(device.deviceId, device);
  return device;
}

// Reset store before each test
beforeEach(() => {
  const store = DeviceStore.getInstance();
  store.devices.clear();
  store.pairing.clear();
  store.commands.clear();
});

afterAll(() => {
  // Clean up any lingering timers
  jest.useRealTimers();
});

// ── Wake route tests ─────────────────────────────────────────────────────────

describe('POST /api/devices/:deviceId/wake', () => {
  it('returns 404 for an unknown device', async () => {
    const res = await request(app)
      .post('/api/devices/nonexistent-device/wake')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Device not found/);
  });

  it('returns 422 when device has no macAddress', async () => {
    seedDevice({ macAddress: undefined, wakeSupported: true });

    const res = await request(app)
      .post('/api/devices/test-device-001/wake')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/MAC address not registered/);
  });

  it('returns 422 when wakeSupported is false', async () => {
    seedDevice({ macAddress: 'AA:BB:CC:DD:EE:FF', wakeSupported: false });

    const res = await request(app)
      .post('/api/devices/test-device-001/wake')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not supported/);
  });

  it('returns 422 when macAddress is invalid', async () => {
    seedDevice({ macAddress: 'not-a-mac', wakeSupported: true });

    const res = await request(app)
      .post('/api/devices/test-device-001/wake')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns 200 and sets wakeStatus to WAKING on success', async () => {
    seedDevice();

    const res = await request(app)
      .post('/api/devices/test-device-001/wake')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.wakeStatus).toBe('WAKING');
    expect(res.body.deviceId).toBe('test-device-001');
    expect(res.body.lastWakeRequestedAt).toBeDefined();
  });

  it('sets device.status to WAKING in the store after wake request', async () => {
    seedDevice();

    await request(app)
      .post('/api/devices/test-device-001/wake')
      .send({});

    const store  = DeviceStore.getInstance();
    const device = store.devices.get('test-device-001');
    expect(device?.status).toBe('WAKING');
    expect(device?.wakeStatus).toBe('WAKING');
    expect(device?.lastWakeRequestedAt).toBeDefined();
  });
});

// ── Heartbeat: WAKING → ONLINE transition ────────────────────────────────────

describe('POST /api/devices/:deviceId/heartbeat — WAKING → ONLINE', () => {
  it('transitions status from WAKING to ONLINE when heartbeat arrives', async () => {
    // Put device in WAKING state
    seedDevice({ status: 'WAKING', wakeStatus: 'WAKING' });
    const store = DeviceStore.getInstance();

    const res = await request(app)
      .post('/api/devices/test-device-001/heartbeat')
      .send({ agentVersion: '0.1.0' });

    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(true);

    const device = store.devices.get('test-device-001');
    expect(device?.status).toBe('ONLINE');
    expect(device?.wakeStatus).toBe('ONLINE');
  });

  it('does not change wakeStatus when device was already ONLINE', async () => {
    seedDevice({ status: 'ONLINE', wakeStatus: 'IDLE' });
    const store = DeviceStore.getInstance();

    await request(app)
      .post('/api/devices/test-device-001/heartbeat')
      .send({ agentVersion: '0.1.0' });

    const device = store.devices.get('test-device-001');
    expect(device?.wakeStatus).toBe('IDLE');
  });

  it('stores macAddress from heartbeat body when provided', async () => {
    seedDevice({ macAddress: undefined });
    const store = DeviceStore.getInstance();

    await request(app)
      .post('/api/devices/test-device-001/heartbeat')
      .send({ agentVersion: '0.1.0', macAddress: 'AA:BB:CC:DD:EE:FF' });

    const device = store.devices.get('test-device-001');
    expect(device?.macAddress).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('stores wakeSupported from heartbeat body when provided', async () => {
    seedDevice({ wakeSupported: false });
    const store = DeviceStore.getInstance();

    await request(app)
      .post('/api/devices/test-device-001/heartbeat')
      .send({ agentVersion: '0.1.0', wakeSupported: true });

    const device = store.devices.get('test-device-001');
    expect(device?.wakeSupported).toBe(true);
  });
});

// ── Registration: MAC and wakeSupported ──────────────────────────────────────

describe('POST /api/devices/register — Phase 3 fields', () => {
  it('stores macAddress on registration', async () => {
    const res = await request(app)
      .post('/api/devices/register')
      .send({
        deviceId:     'reg-test-001',
        deviceName:   'Test Rig',
        macAddress:   'AA:BB:CC:DD:EE:FF',
        wakeSupported: true,
      });

    expect(res.status).toBe(200);
    const store  = DeviceStore.getInstance();
    const device = store.devices.get('reg-test-001');
    expect(device?.macAddress).toBe('AA:BB:CC:DD:EE:FF');
    expect(device?.wakeSupported).toBe(true);
  });

  it('defaults wakeSupported to false when not provided', async () => {
    await request(app)
      .post('/api/devices/register')
      .send({ deviceId: 'reg-test-002', deviceName: 'Another PC' });

    const store  = DeviceStore.getInstance();
    const device = store.devices.get('reg-test-002');
    expect(device?.wakeSupported).toBe(false);
  });
});
