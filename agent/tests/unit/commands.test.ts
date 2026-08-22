import { CommandHandler } from '../../src/commands/CommandHandler';
import { IdentityManager } from '../../src/identity/IdentityManager';
import { PairingManager } from '../../src/pairing/PairingManager';
import { AgentStateManager } from '../../src/agent/AgentState';
import { SecureStorage } from '../../src/storage/SecureStorage';
import type { StorageProvider } from '../../src/storage/StorageProvider';
import type { AgentCommand } from '../../src/commands/CommandHandler';
import type { AgentConfig } from '../../src/config/Config';
import { v4 as uuidv4 } from 'uuid';

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
  backendUrl: 'http://localhost:3001',
  heartbeatIntervalMs: 30_000,
  pairingExpiryMs: 5 * 60_000,
  agentVersion: '0.1.0',
  storageDir: '/tmp/test',
  debug: false,
};

async function makeHandler() {
  const storage  = makeMemoryStorage();
  const identity = new IdentityManager(storage, '0.1.0');
  await identity.init();
  const pairing  = new PairingManager(identity, storage, CONFIG);
  const state    = new AgentStateManager();
  const handler  = new CommandHandler(identity, pairing, state);
  return { identity, pairing, state, handler };
}

function makeCommand(
  deviceId: string,
  type: AgentCommand['type'],
  payload: Record<string, unknown> = {},
  overrides: Partial<AgentCommand> = {},
): AgentCommand {
  const now = new Date();
  return {
    commandId: uuidv4(),
    deviceId,
    type,
    timestamp: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    payload,
    ...overrides,
  };
}

describe('CommandHandler', () => {
  describe('PING', () => {
    it('returns pong for valid PING command', async () => {
      const { handler, identity } = await makeHandler();
      const cmd = makeCommand(identity.get().deviceId, 'PING');

      const result = await handler.handle(cmd);

      expect(result.success).toBe(true);
      expect(result.data?.['pong']).toBe(true);
      expect(result.data?.['timestamp']).toBeDefined();
    });
  });

  describe('STATUS_REQUEST', () => {
    it('returns device status info', async () => {
      const { handler, identity } = await makeHandler();
      const cmd = makeCommand(identity.get().deviceId, 'STATUS_REQUEST');

      const result = await handler.handle(cmd);

      expect(result.success).toBe(true);
      expect(result.data?.['deviceId']).toBe(identity.get().deviceId);
      expect(result.data?.['agentVersion']).toBe('0.1.0');
      expect(result.data?.['pairingStatus']).toBe('UNPAIRED');
    });
  });

  describe('Validation', () => {
    it('rejects command addressed to a different device', async () => {
      const { handler } = await makeHandler();
      const cmd = makeCommand('some-other-device-id', 'PING');

      const result = await handler.handle(cmd);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/deviceId does not match/);
    });

    it('rejects an expired command', async () => {
      const { handler, identity } = await makeHandler();
      const cmd = makeCommand(identity.get().deviceId, 'PING', {}, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      const result = await handler.handle(cmd);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/expired/);
    });

    it('rejects a duplicate command (replay protection)', async () => {
      const { handler, identity } = await makeHandler();
      const cmd = makeCommand(identity.get().deviceId, 'PING');

      const first  = await handler.handle(cmd);
      const second = await handler.handle(cmd);

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already processed/);
    });

    it('accepts two different commands with different commandIds', async () => {
      const { handler, identity } = await makeHandler();
      const deviceId = identity.get().deviceId;

      const cmd1 = makeCommand(deviceId, 'PING');
      const cmd2 = makeCommand(deviceId, 'PING');

      const r1 = await handler.handle(cmd1);
      const r2 = await handler.handle(cmd2);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  describe('PAIR_CONFIRM', () => {
    it('confirms pairing with valid code and userId', async () => {
      const { handler, pairing, identity } = await makeHandler();
      const session = await pairing.generatePairingSession();
      const deviceId = identity.get().deviceId;

      const cmd = makeCommand(deviceId, 'PAIR_CONFIRM', {
        userId:      'user-123',
        pairingCode: session.pairingCode,
      });

      const result = await handler.handle(cmd);

      expect(result.success).toBe(true);
      expect(identity.get().pairingStatus).toBe('PAIRED');
    });

    it('rejects PAIR_CONFIRM without userId', async () => {
      const { handler, pairing, identity } = await makeHandler();
      await pairing.generatePairingSession();

      const cmd = makeCommand(identity.get().deviceId, 'PAIR_CONFIRM', {
        pairingCode: 'ABC123',
        // no userId
      });

      const result = await handler.handle(cmd);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/userId/);
    });

    it('rejects PAIR_CONFIRM with wrong code', async () => {
      const { handler, pairing, identity } = await makeHandler();
      await pairing.generatePairingSession();

      const cmd = makeCommand(identity.get().deviceId, 'PAIR_CONFIRM', {
        userId:      'user-123',
        pairingCode: 'XXXXXX',
      });

      const result = await handler.handle(cmd);
      expect(result.success).toBe(false);
    });
  });

  describe('Unimplemented commands', () => {
    it.each(['WAKE_REQUEST', 'CONNECT_REQUEST', 'SHUTDOWN_REQUEST', 'SLEEP_REQUEST'])(
      '%s returns not-implemented error',
      async (type) => {
        const { handler, identity } = await makeHandler();
        const cmd = makeCommand(
          identity.get().deviceId,
          type as AgentCommand['type'],
        );

        const result = await handler.handle(cmd);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not yet implemented/);
      },
    );
  });
});
