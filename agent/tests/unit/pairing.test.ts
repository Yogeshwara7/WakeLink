import { PairingManager } from '../../src/pairing/PairingManager';
import { IdentityManager } from '../../src/identity/IdentityManager';
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

const TEST_CONFIG: AgentConfig = {
  backendUrl:           'http://localhost:3001',
  heartbeatIntervalMs:  30_000,
  pairingExpiryMs:      5 * 60_000,  // 5 minutes
  agentVersion:         '0.1.0',
  storageDir:           '/tmp/test',
  debug:                false,
};

const SHORT_EXPIRY_CONFIG: AgentConfig = {
  ...TEST_CONFIG,
  pairingExpiryMs: 1, // 1ms — expires immediately for tests
};

async function makeManager(config = TEST_CONFIG) {
  const storage = makeMemoryStorage();
  const identity = new IdentityManager(storage, '0.1.0');
  await identity.init();
  const pairing = new PairingManager(identity, storage, config);
  return { identity, pairing, storage };
}

describe('PairingManager', () => {
  describe('generatePairingSession()', () => {
    it('generates a session with a 6-character code', async () => {
      const { pairing } = await makeManager();
      const session = await pairing.generatePairingSession();

      expect(session.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(session.sessionId).toBeDefined();
      expect(session.consumed).toBe(false);
    });

    it('code is not trivially predictable (not sequential)', async () => {
      const { pairing } = await makeManager();
      const codes = await Promise.all(
        Array.from({ length: 5 }, () => pairing.generatePairingSession()
          .then(s => s.pairingCode)),
      );
      // Each call on the SAME manager returns the cached session, so
      // create separate managers for uniqueness test
      const codes2: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { pairing: p } = await makeManager();
        const s = await p.generatePairingSession();
        codes2.push(s.pairingCode);
      }
      const unique = new Set(codes2);
      // With 6 chars from ~30 possibilities, getting 5 identical codes
      // has probability ~(1/30^6)^4 — essentially zero
      expect(unique.size).toBeGreaterThan(1);
    });

    it('reuses a non-expired session on subsequent calls', async () => {
      const { pairing } = await makeManager();
      const s1 = await pairing.generatePairingSession();
      const s2 = await pairing.generatePairingSession();
      expect(s2.sessionId).toBe(s1.sessionId);
      expect(s2.pairingCode).toBe(s1.pairingCode);
    });

    it('sets expiresAt based on config.pairingExpiryMs', async () => {
      const { pairing } = await makeManager();
      const before = Date.now();
      const session = await pairing.generatePairingSession();
      const after = Date.now();

      const expiry = new Date(session.expiresAt).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + TEST_CONFIG.pairingExpiryMs - 50);
      expect(expiry).toBeLessThanOrEqual(after  + TEST_CONFIG.pairingExpiryMs + 50);
    });

    it('qrPayload contains correct device info', async () => {
      const { pairing, identity } = await makeManager();
      const session = await pairing.generatePairingSession();

      expect(session.qrPayload.type).toBe('wakelink-pair');
      expect(session.qrPayload.version).toBe(1);
      expect(session.qrPayload.deviceId).toBe(identity.get().deviceId);
      expect(session.qrPayload.pairingCode).toBe(session.pairingCode);
    });
  });

  describe('validatePairingRequest()', () => {
    it('accepts a valid code for this device', async () => {
      const { pairing, identity } = await makeManager();
      const session = await pairing.generatePairingSession();

      const result = await pairing.validatePairingRequest(
        session.pairingCode,
        identity.get().deviceId,
      );

      expect(result.valid).toBe(true);
    });

    it('rejects wrong deviceId', async () => {
      const { pairing } = await makeManager();
      const session = await pairing.generatePairingSession();

      const result = await pairing.validatePairingRequest(
        session.pairingCode,
        'wrong-device-id',
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Device ID mismatch/);
    });

    it('rejects wrong pairing code', async () => {
      const { pairing, identity } = await makeManager();
      await pairing.generatePairingSession();

      const result = await pairing.validatePairingRequest(
        'XXXXXX',
        identity.get().deviceId,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid pairing code/);
    });

    it('is single-use — rejects second validation attempt', async () => {
      const { pairing, identity } = await makeManager();
      const session = await pairing.generatePairingSession();
      const deviceId = identity.get().deviceId;

      const first = await pairing.validatePairingRequest(
        session.pairingCode, deviceId,
      );
      expect(first.valid).toBe(true);

      const second = await pairing.validatePairingRequest(
        session.pairingCode, deviceId,
      );
      expect(second.valid).toBe(false);
      expect(second.reason).toMatch(/already used/);
    });

    it('rejects expired session', async () => {
      const { pairing, identity } = await makeManager(SHORT_EXPIRY_CONFIG);
      const session = await pairing.generatePairingSession();

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));

      const result = await pairing.validatePairingRequest(
        session.pairingCode,
        identity.get().deviceId,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/);
    });

    it('rejects when no session exists', async () => {
      const { pairing, identity } = await makeManager();

      const result = await pairing.validatePairingRequest(
        'ABC123',
        identity.get().deviceId,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/No active pairing session/);
    });

    it('is case-insensitive', async () => {
      const { pairing, identity } = await makeManager();
      const session = await pairing.generatePairingSession();

      const result = await pairing.validatePairingRequest(
        session.pairingCode.toLowerCase(),
        identity.get().deviceId,
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('completePairing()', () => {
    it('marks identity as PAIRED', async () => {
      const { pairing, identity } = await makeManager();
      await pairing.generatePairingSession();
      await pairing.completePairing('user-xyz');

      expect(identity.get().pairingStatus).toBe('PAIRED');
      expect(identity.get().pairedUserId).toBe('user-xyz');
    });

    it('removes the pairing session from storage after completion', async () => {
      const { pairing, storage } = await makeManager();
      await pairing.generatePairingSession();
      await pairing.completePairing('user-xyz');

      const session = await pairing.getActiveSession();
      expect(session).toBeNull();
    });
  });
});
