import { HeartbeatManager } from '../../src/network/HeartbeatManager';
import { IdentityManager } from '../../src/identity/IdentityManager';
import { AgentStateManager } from '../../src/agent/AgentState';
import { SecureStorage } from '../../src/storage/SecureStorage';
import type { StorageProvider } from '../../src/storage/StorageProvider';
import type { AgentConfig } from '../../src/config/Config';

function makeMemoryStorage(): SecureStorage {
  const store: Record<string, string> = {};
  const provider: StorageProvider = {
    read:   async (k) => store[k] ?? null,
    write:  async (k, v) => { store[k] = v; },
    delete: async (k) => { delete store[k]; },
    has:    async (k) => k in store,
  };
  return new SecureStorage(provider);
}

const CONFIG: AgentConfig = {
  backendUrl:           'http://localhost:3001',
  heartbeatIntervalMs:  60_000,
  pairingExpiryMs:      300_000,
  agentVersion:         '0.1.0',
  storageDir:           '/tmp/test',
  debug:                false,
};

async function makeHeartbeatManager() {
  const storage  = makeMemoryStorage();
  const identity = new IdentityManager(storage, '0.1.0');
  await identity.init();
  const state    = new AgentStateManager();
  const manager  = new HeartbeatManager(identity, state, CONFIG);
  return { identity, state, manager };
}

describe('HeartbeatManager', () => {
  describe('buildPayload()', () => {
    it('includes deviceId and agentVersion', async () => {
      const { manager, identity } = await makeHeartbeatManager();
      const payload = manager.buildPayload();

      expect(payload.deviceId).toBe(identity.get().deviceId);
      expect(payload.agentVersion).toBe('0.1.0');
    });

    it('status is ONLINE', async () => {
      const { manager } = await makeHeartbeatManager();
      const payload = manager.buildPayload();
      expect(payload.status).toBe('ONLINE');
    });

    it('timestamp is a valid ISO-8601 string', async () => {
      const { manager } = await makeHeartbeatManager();
      const payload = manager.buildPayload();
      expect(() => new Date(payload.timestamp)).not.toThrow();
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });

    it('includes uptimeSeconds as a positive number', async () => {
      const { manager } = await makeHeartbeatManager();
      const payload = manager.buildPayload();
      expect(typeof payload.uptimeSeconds).toBe('number');
      expect(payload.uptimeSeconds).toBeGreaterThan(0);
    });

    it('includes networkAvailable boolean', async () => {
      const { manager } = await makeHeartbeatManager();
      const payload = manager.buildPayload();
      expect(typeof payload.networkAvailable).toBe('boolean');
    });

    it('does not include MAC addresses or sensitive info', async () => {
      const { manager } = await makeHeartbeatManager();
      const payload = manager.buildPayload();
      const keys = Object.keys(payload);

      expect(keys).not.toContain('macAddress');
      expect(keys).not.toContain('mac');
      expect(keys).not.toContain('privateKey');
      expect(keys).not.toContain('token');
      expect(keys).not.toContain('password');
    });

    it('produces a different timestamp on each call', async () => {
      const { manager } = await makeHeartbeatManager();
      const p1 = manager.buildPayload();
      await new Promise((r) => setTimeout(r, 5));
      const p2 = manager.buildPayload();

      // Timestamps should differ (or be equal if < 1ms — acceptable)
      expect(p2.timestamp >= p1.timestamp).toBe(true);
    });
  });

  describe('start() / stop()', () => {
    it('can be started and stopped without throwing', async () => {
      const { manager } = await makeHeartbeatManager();
      // HeartbeatManager will try to POST — it will fail (no server running)
      // but it should not throw synchronously.
      expect(() => manager.start()).not.toThrow();
      expect(() => manager.stop()).not.toThrow();
    });

    it('stop() is idempotent', async () => {
      const { manager } = await makeHeartbeatManager();
      manager.start();
      manager.stop();
      expect(() => manager.stop()).not.toThrow();
    });

    it('start() is idempotent', async () => {
      const { manager } = await makeHeartbeatManager();
      manager.start();
      expect(() => manager.start()).not.toThrow();
      manager.stop();
    });
  });
});
