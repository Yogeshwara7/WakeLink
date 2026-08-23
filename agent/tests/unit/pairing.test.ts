import { PairingManager } from '../../src/pairing/PairingManager';
import { IdentityManager } from '../../src/identity/IdentityManager';
import { SecureStorage } from '../../src/storage/SecureStorage';
import type { StorageProvider } from '../../src/storage/StorageProvider';
import type { AgentConfig } from '../../src/config/Config';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  pairingExpiryMs:      5 * 60_000,
  agentVersion:         '0.1.0',
  storageDir:           '/tmp/test',
  debug:                false,
};

const SHORT_EXPIRY_CONFIG: AgentConfig = {
  ...TEST_CONFIG,
  pairingExpiryMs: 1, // expires in 1 ms — for expiry tests
};

async function makeManager(config = TEST_CONFIG) {
  const storage  = makeMemoryStorage();
  const identity = new IdentityManager(storage, '0.1.0');
  await identity.init();
  const pairing  = new PairingManager(identity, storage, config);
  return { identity, pairing, storage };
}

// ═══════════════════════════════════════════════════════════════════════════
// Existing tests (Phase 2) — must all still pass
// ═══════════════════════════════════════════════════════════════════════════

describe('PairingManager — generatePairingSession()', () => {
  it('generates a session with a 6-character alphanumeric code', async () => {
    const { pairing } = await makeManager();
    const session = await pairing.generatePairingSession();
    expect(session.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(session.sessionId).toBeDefined();
    expect(session.consumed).toBe(false);
  });

  it('codes are not sequential / trivially predictable', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { pairing: p } = await makeManager();
      const s = await p.generatePairingSession();
      codes.push(s.pairingCode);
    }
    expect(new Set(codes).size).toBeGreaterThan(1);
  });

  it('reuses a non-expired session on subsequent calls', async () => {
    const { pairing } = await makeManager();
    const s1 = await pairing.generatePairingSession();
    const s2 = await pairing.generatePairingSession();
    expect(s2.sessionId).toBe(s1.sessionId);
    expect(s2.pairingCode).toBe(s1.pairingCode);
  });

  it('sets expiresAt from config.pairingExpiryMs', async () => {
    const { pairing } = await makeManager();
    const before = Date.now();
    const session = await pairing.generatePairingSession();
    const after   = Date.now();
    const expiry  = new Date(session.expiresAt).getTime();
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

describe('PairingManager — validatePairingRequest()', () => {
  it('accepts a valid code for this device', async () => {
    const { pairing, identity } = await makeManager();
    const session = await pairing.generatePairingSession();
    const result  = await pairing.validatePairingRequest(
      session.pairingCode, identity.get().deviceId,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects wrong deviceId', async () => {
    const { pairing } = await makeManager();
    const session = await pairing.generatePairingSession();
    const result  = await pairing.validatePairingRequest(session.pairingCode, 'wrong-id');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Device ID mismatch/);
  });

  it('rejects wrong pairing code', async () => {
    const { pairing, identity } = await makeManager();
    await pairing.generatePairingSession();
    const result = await pairing.validatePairingRequest('XXXXXX', identity.get().deviceId);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Invalid pairing code/);
  });

  it('is single-use — rejects second attempt with same code', async () => {
    const { pairing, identity } = await makeManager();
    const session  = await pairing.generatePairingSession();
    const deviceId = identity.get().deviceId;
    const first    = await pairing.validatePairingRequest(session.pairingCode, deviceId);
    expect(first.valid).toBe(true);
    const second   = await pairing.validatePairingRequest(session.pairingCode, deviceId);
    expect(second.valid).toBe(false);
    expect(second.reason).toMatch(/already used/);
  });

  it('rejects expired session', async () => {
    const { pairing, identity } = await makeManager(SHORT_EXPIRY_CONFIG);
    const session = await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));
    const result  = await pairing.validatePairingRequest(
      session.pairingCode, identity.get().deviceId,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it('rejects when no session exists', async () => {
    const { pairing, identity } = await makeManager();
    const result = await pairing.validatePairingRequest('ABC123', identity.get().deviceId);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/No active pairing session/);
  });

  it('is case-insensitive', async () => {
    const { pairing, identity } = await makeManager();
    const session = await pairing.generatePairingSession();
    const result  = await pairing.validatePairingRequest(
      session.pairingCode.toLowerCase(), identity.get().deviceId,
    );
    expect(result.valid).toBe(true);
  });
});

describe('PairingManager — completePairing()', () => {
  it('marks identity as PAIRED', async () => {
    const { pairing, identity } = await makeManager();
    await pairing.generatePairingSession();
    await pairing.completePairing('user-xyz');
    expect(identity.get().pairingStatus).toBe('PAIRED');
    expect(identity.get().pairedUserId).toBe('user-xyz');
  });

  it('removes the pairing session from storage after completion', async () => {
    const { pairing } = await makeManager();
    await pairing.generatePairingSession();
    await pairing.completePairing('user-xyz');
    expect(await pairing.getActiveSession()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4 — pairing lifecycle tests (new requirements)
// ═══════════════════════════════════════════════════════════════════════════

describe('PairingManager — inspectSession()', () => {
  it('returns exists=false when no session has been created', async () => {
    const { pairing } = await makeManager();
    const info = await pairing.inspectSession();
    expect(info.exists).toBe(false);
    expect(info.session).toBeNull();
  });

  it('returns exists=true, expired=false for a fresh session', async () => {
    const { pairing } = await makeManager();
    await pairing.generatePairingSession();
    const info = await pairing.inspectSession();
    expect(info.exists).toBe(true);
    expect(info.expired).toBe(false);
    expect(info.consumed).toBe(false);
  });

  it('returns expired=true for an expired session', async () => {
    const { pairing } = await makeManager(SHORT_EXPIRY_CONFIG);
    await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));
    const info = await pairing.inspectSession();
    expect(info.exists).toBe(true);
    expect(info.expired).toBe(true);
  });

  it('returns consumed=true after successful pairing', async () => {
    const { pairing, identity } = await makeManager();
    const session = await pairing.generatePairingSession();
    // Consume the session via validate
    await pairing.validatePairingRequest(session.pairingCode, identity.get().deviceId);
    const info = await pairing.inspectSession();
    expect(info.consumed).toBe(true);
  });
});

describe('PairingManager — resetExpiredSession()', () => {
  it('removes the stale session from storage', async () => {
    const { pairing } = await makeManager(SHORT_EXPIRY_CONFIG);
    await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));

    await pairing.resetExpiredSession();

    const info = await pairing.inspectSession();
    expect(info.exists).toBe(false);
  });

  it('rolls pairingStatus back to UNPAIRED', async () => {
    const { pairing, identity } = await makeManager(SHORT_EXPIRY_CONFIG);
    await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));

    // At this point identity is PAIRING — simulate the stuck state
    expect(identity.get().pairingStatus).toBe('PAIRING');

    await pairing.resetExpiredSession();

    expect(identity.get().pairingStatus).toBe('UNPAIRED');
  });

  it('does NOT change the deviceId', async () => {
    const { pairing, identity } = await makeManager(SHORT_EXPIRY_CONFIG);
    const originalDeviceId = identity.get().deviceId;

    await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));
    await pairing.resetExpiredSession();

    expect(identity.get().deviceId).toBe(originalDeviceId);
  });

  it('does NOT change the deviceName', async () => {
    const { pairing, identity } = await makeManager(SHORT_EXPIRY_CONFIG);
    const originalName = identity.get().deviceName;

    await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));
    await pairing.resetExpiredSession();

    expect(identity.get().deviceName).toBe(originalName);
  });

  it('allows generatePairingSession() after reset — produces a NEW code', async () => {
    const { pairing } = await makeManager(SHORT_EXPIRY_CONFIG);
    const first = await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));

    await pairing.resetExpiredSession();
    const second = await pairing.generatePairingSession();

    // New session must have a fresh sessionId and code
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.consumed).toBe(false);
    expect(second.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    // New expiry must be in the future (even with 1ms config, generated just now)
    expect(new Date(second.expiresAt).getTime()).toBeGreaterThan(Date.now() - 100);
  });
});

// ── Pairing startup scenarios ─────────────────────────────────────────────

describe('Pairing startup scenarios', () => {
  /**
   * Simulates what Agent.ts does on startup for each pairingStatus value.
   * We test the PairingManager methods directly rather than the full Agent
   * to keep tests fast and isolated.
   */

  it('UNPAIRED → generates a new pairing session', async () => {
    const { pairing, identity } = await makeManager();
    expect(identity.get().pairingStatus).toBe('UNPAIRED');

    const session = await pairing.generatePairingSession();

    expect(session.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(identity.get().pairingStatus).toBe('PAIRING');
  });

  it('PAIRING + valid session → reuse existing session (same code)', async () => {
    const { pairing, identity } = await makeManager();

    // First startup: generate session
    const first = await pairing.generatePairingSession();
    expect(identity.get().pairingStatus).toBe('PAIRING');

    // Second startup simulation: inspect, find valid
    const info = await pairing.inspectSession();
    expect(info.exists).toBe(true);
    expect(info.expired).toBe(false);
    expect(info.consumed).toBe(false);

    // Reuse the session — code is unchanged
    const reused = info.session!;
    expect(reused.pairingCode).toBe(first.pairingCode);
    expect(reused.sessionId).toBe(first.sessionId);
  });

  it('PAIRING + expired session → reset and generate new session', async () => {
    const { pairing, identity } = await makeManager(SHORT_EXPIRY_CONFIG);
    const originalDeviceId = identity.get().deviceId;

    // First startup: generate session, which expires in 1ms
    const first = await pairing.generatePairingSession();
    await new Promise((r) => setTimeout(r, 10));

    // Second startup simulation: detect expired, reset, generate fresh
    const info = await pairing.inspectSession();
    expect(info.expired).toBe(true);

    await pairing.resetExpiredSession();
    expect(identity.get().pairingStatus).toBe('UNPAIRED');
    expect(identity.get().deviceId).toBe(originalDeviceId); // deviceId unchanged

    const fresh = await pairing.generatePairingSession();
    expect(fresh.sessionId).not.toBe(first.sessionId);
    expect(identity.get().pairingStatus).toBe('PAIRING');
  });

  it('PAIRING + missing session → generates new session', async () => {
    const { pairing, identity, storage } = await makeManager();

    // Put identity in PAIRING state manually (simulates interrupted startup)
    await identity.markPairing();
    expect(identity.get().pairingStatus).toBe('PAIRING');

    // No active_pairing_session in storage (it was never saved or was deleted)
    const info = await pairing.inspectSession();
    expect(info.exists).toBe(false);

    // Agent.ts logic: missing session → reset → generate fresh
    await pairing.resetExpiredSession();
    expect(identity.get().pairingStatus).toBe('UNPAIRED');

    const session = await pairing.generatePairingSession();
    expect(session.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(identity.get().pairingStatus).toBe('PAIRING');
  });

  it('PAIRED → pairingStatus stays PAIRED, no new session generated', async () => {
    const { pairing, identity } = await makeManager();

    // Simulate successful pairing
    await pairing.generatePairingSession();
    await pairing.completePairing('user-123');

    expect(identity.get().pairingStatus).toBe('PAIRED');
    expect(identity.get().pairedUserId).toBe('user-123');

    // Agent.ts checks PAIRED → skips session generation entirely
    // Verify no session is active
    const info = await pairing.inspectSession();
    expect(info.exists).toBe(false);
  });

  it('PAIRED persists across restart — pairingStatus stays PAIRED', async () => {
    const storage  = makeMemoryStorage();
    const identity = new IdentityManager(storage, '0.1.0');
    await identity.init();
    const pairing  = new PairingManager(identity, storage, TEST_CONFIG);

    // Complete pairing
    await pairing.generatePairingSession();
    await pairing.completePairing('user-restart-test');

    // Simulate restart — create a new IdentityManager over the same storage
    const identity2 = new IdentityManager(storage, '0.1.0');
    const loaded    = await identity2.init();

    expect(loaded.pairingStatus).toBe('PAIRED');
    expect(loaded.pairedUserId).toBe('user-restart-test');
    expect(loaded.deviceId).toBe(identity.get().deviceId);
  });

  it('consumed session cannot be reused after restart', async () => {
    const storage  = makeMemoryStorage();
    const identity = new IdentityManager(storage, '0.1.0');
    await identity.init();
    const pairing  = new PairingManager(identity, storage, TEST_CONFIG);

    const session = await pairing.generatePairingSession();
    // Consume it
    await pairing.validatePairingRequest(session.pairingCode, identity.get().deviceId);

    // Simulate restart
    const identity2 = new IdentityManager(storage, '0.1.0');
    await identity2.init();
    const pairing2  = new PairingManager(identity2, storage, TEST_CONFIG);

    const info = await pairing2.inspectSession();
    expect(info.consumed).toBe(true);

    // Attempting to validate the consumed code again must fail
    const result = await pairing2.validatePairingRequest(
      session.pairingCode, identity2.get().deviceId,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/already used/);
  });
});
