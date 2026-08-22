import { IdentityManager } from '../../src/identity/IdentityManager';
import { SecureStorage } from '../../src/storage/SecureStorage';
import type { StorageProvider } from '../../src/storage/StorageProvider';

/** In-memory StorageProvider for tests — no disk I/O. */
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

describe('IdentityManager', () => {
  it('generates a new identity on first init', async () => {
    const storage = makeMemoryStorage();
    const mgr = new IdentityManager(storage, '0.1.0');
    const identity = await mgr.init();

    expect(identity.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(identity.platform).toBe('windows');
    expect(identity.pairingStatus).toBe('UNPAIRED');
    expect(identity.pairedUserId).toBeNull();
    expect(identity.publicKey).toBeNull();
    expect(identity.agentVersion).toBe('0.1.0');
    expect(identity.createdAt).toBeDefined();
  });

  it('loads the same deviceId on subsequent inits (no regeneration)', async () => {
    const storage = makeMemoryStorage();

    const mgr1 = new IdentityManager(storage, '0.1.0');
    const first = await mgr1.init();

    const mgr2 = new IdentityManager(storage, '0.1.0');
    const second = await mgr2.init();

    expect(second.deviceId).toBe(first.deviceId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('updates agentVersion on reload without changing deviceId', async () => {
    const storage = makeMemoryStorage();

    const mgr1 = new IdentityManager(storage, '0.1.0');
    const first = await mgr1.init();

    const mgr2 = new IdentityManager(storage, '0.2.0');
    const second = await mgr2.init();

    expect(second.deviceId).toBe(first.deviceId);
    expect(second.agentVersion).toBe('0.2.0');
  });

  it('updates lastSeenAt on touchLastSeen', async () => {
    const storage = makeMemoryStorage();
    const mgr = new IdentityManager(storage, '0.1.0');
    await mgr.init();

    const before = mgr.get().lastSeenAt;
    await new Promise((r) => setTimeout(r, 10));
    await mgr.touchLastSeen();
    const after = mgr.get().lastSeenAt;

    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('marks as PAIRED with userId', async () => {
    const storage = makeMemoryStorage();
    const mgr = new IdentityManager(storage, '0.1.0');
    await mgr.init();

    await mgr.markPaired('user-abc');

    expect(mgr.get().pairingStatus).toBe('PAIRED');
    expect(mgr.get().pairedUserId).toBe('user-abc');
  });

  it('resets identity — new deviceId generated after reset', async () => {
    const storage = makeMemoryStorage();
    const mgr = new IdentityManager(storage, '0.1.0');
    const first = await mgr.init();

    await mgr.reset();

    const mgr2 = new IdentityManager(storage, '0.1.0');
    const second = await mgr2.init();

    expect(second.deviceId).not.toBe(first.deviceId);
    expect(second.pairingStatus).toBe('UNPAIRED');
  });

  it('throws if get() called before init()', () => {
    const storage = makeMemoryStorage();
    const mgr = new IdentityManager(storage, '0.1.0');
    expect(() => mgr.get()).toThrow('not initialised');
  });

  it('renames device and persists', async () => {
    const storage = makeMemoryStorage();
    const mgr = new IdentityManager(storage, '0.1.0');
    await mgr.init();

    await mgr.rename('My Gaming Rig');

    const mgr2 = new IdentityManager(storage, '0.1.0');
    await mgr2.init();
    expect(mgr2.get().deviceName).toBe('My Gaming Rig');
  });
});
