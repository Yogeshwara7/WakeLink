import { CommandHandler }         from '../../src/commands/CommandHandler';
import { IdentityManager }        from '../../src/identity/IdentityManager';
import { PairingManager }         from '../../src/pairing/PairingManager';
import { AgentStateManager }      from '../../src/agent/AgentState';
import { SecureStorage }          from '../../src/storage/SecureStorage';
import { MockSessionProvider }    from '../../src/session/MockSessionProvider';
import type { StorageProvider }   from '../../src/storage/StorageProvider';
import type { AgentCommand }      from '../../src/commands/CommandHandler';
import type { AgentConfig }       from '../../src/config/Config';
import { v4 as uuidv4 } from 'uuid';

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

const CONFIG: AgentConfig = {
  backendUrl: 'http://localhost:3001',
  heartbeatIntervalMs: 30_000,
  pairingExpiryMs: 5 * 60_000,
  agentVersion: '0.1.0',
  storageDir: '/tmp/test',
  debug: false,
};

async function makeHandler(opts?: {
  sessionProvider?: MockSessionProvider;
  paired?: boolean;
}) {
  const storage  = makeMemoryStorage();
  const identity = new IdentityManager(storage, '0.1.0');
  await identity.init();
  const pairing  = new PairingManager(identity, storage, CONFIG);
  const state    = new AgentStateManager();

  if (opts?.paired) {
    // Simulate paired state so CONNECT_REQUEST passes the pairing check
    await pairing.generatePairingSession();
    await pairing.completePairing('user-test');
  }

  const handler = new CommandHandler(
    identity,
    pairing,
    state,
    opts?.sessionProvider,
    'http://localhost:3001',
  );
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

// ═══════════════════════════════════════════════════════════════════════════
// Existing Phase 2 tests — must all still pass
// ═══════════════════════════════════════════════════════════════════════════

describe('CommandHandler — PING', () => {
  it('returns pong for valid PING command', async () => {
    const { handler, identity } = await makeHandler();
    const result = await handler.handle(makeCommand(identity.get().deviceId, 'PING'));
    expect(result.success).toBe(true);
    expect(result.data?.['pong']).toBe(true);
    expect(result.data?.['timestamp']).toBeDefined();
  });
});

describe('CommandHandler — STATUS_REQUEST', () => {
  it('returns device status info including sessionProvider name', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider });
    const result = await handler.handle(makeCommand(identity.get().deviceId, 'STATUS_REQUEST'));
    expect(result.success).toBe(true);
    expect(result.data?.['deviceId']).toBe(identity.get().deviceId);
    expect(result.data?.['agentVersion']).toBe('0.1.0');
    expect(result.data?.['sessionProvider']).toBe('MockSessionProvider');
  });
});

describe('CommandHandler — Validation', () => {
  it('rejects command addressed to a different device', async () => {
    const { handler } = await makeHandler();
    const result = await handler.handle(makeCommand('wrong-device', 'PING'));
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

  it('accepts two different commandIds', async () => {
    const { handler, identity } = await makeHandler();
    const r1 = await handler.handle(makeCommand(identity.get().deviceId, 'PING'));
    const r2 = await handler.handle(makeCommand(identity.get().deviceId, 'PING'));
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

describe('CommandHandler — PAIR_CONFIRM', () => {
  it('confirms pairing with valid code and userId', async () => {
    const { handler, pairing, identity } = await makeHandler();
    const session = await pairing.generatePairingSession();
    const result  = await handler.handle(makeCommand(identity.get().deviceId, 'PAIR_CONFIRM', {
      userId: 'user-123', pairingCode: session.pairingCode,
    }));
    expect(result.success).toBe(true);
    expect(identity.get().pairingStatus).toBe('PAIRED');
  });

  it('rejects PAIR_CONFIRM without userId', async () => {
    const { handler, pairing, identity } = await makeHandler();
    await pairing.generatePairingSession();
    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'PAIR_CONFIRM', { pairingCode: 'ABC123' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/userId/);
  });

  it('rejects PAIR_CONFIRM with wrong code', async () => {
    const { handler, pairing, identity } = await makeHandler();
    await pairing.generatePairingSession();
    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'PAIR_CONFIRM', { userId: 'u1', pairingCode: 'XXXXXX' }),
    );
    expect(result.success).toBe(false);
  });
});

describe('CommandHandler — Unimplemented commands', () => {
  it.each(['WAKE_REQUEST', 'SHUTDOWN_REQUEST', 'SLEEP_REQUEST'])(
    '%s returns not-implemented error',
    async (type) => {
      const { handler, identity } = await makeHandler();
      const result = await handler.handle(
        makeCommand(identity.get().deviceId, type as AgentCommand['type']),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not yet implemented/);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5 — CONNECT_REQUEST tests
// ═══════════════════════════════════════════════════════════════════════════

describe('CommandHandler — CONNECT_REQUEST', () => {
  it('rejects CONNECT_REQUEST when device is not paired', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider });
    // identity is UNPAIRED by default
    expect(identity.get().pairingStatus).toBe('UNPAIRED');

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId: 'sess-001', sessionToken: 'tok-001',
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not paired/);
  });

  it('rejects CONNECT_REQUEST when no session provider configured', async () => {
    const { handler, identity } = await makeHandler({ paired: true });
    // No sessionProvider passed to handler
    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId: 'sess-001', sessionToken: 'tok-001',
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No session provider/);
  });

  it('rejects CONNECT_REQUEST missing sessionId', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', { sessionToken: 'tok' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sessionId/);
  });

  it('rejects CONNECT_REQUEST missing sessionToken', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', { sessionId: 'sess-001' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sessionToken/);
  });

  it('succeeds with MockSessionProvider when paired', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId:    'sess-live-001',
        sessionToken: 'tok-secret',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.['sessionId']).toBe('sess-live-001');
    expect(result.data?.['sessionType']).toBe('mock');
    // sessionToken must NOT appear in result data
    expect(JSON.stringify(result.data)).not.toContain('tok-secret');
  });

  it('registers session as active in MockSessionProvider', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId: 'active-sess', sessionToken: 'tok',
      }),
    );

    expect(sessionProvider.isSessionActive('active-sess')).toBe(true);
  });

  it('returns wsProxyPath in result data', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId: 'ws-test', sessionToken: 'tok',
      }),
    );

    expect(result.data?.['wsProxyPath']).toBe('/api/sessions/ws-test/ws');
  });

  it('handles session start failure gracefully', async () => {
    // Create a mock provider that throws
    const failingProvider = new MockSessionProvider();
    // Override startSession to reject
    jest.spyOn(failingProvider, 'startSession').mockRejectedValueOnce(
      new Error('VNC not available'),
    );

    const { handler, identity } = await makeHandler({ sessionProvider: failingProvider, paired: true });

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId: 'fail-sess', sessionToken: 'tok',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/VNC not available/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5 — DISCONNECT_REQUEST tests
// ═══════════════════════════════════════════════════════════════════════════

describe('CommandHandler — DISCONNECT_REQUEST', () => {
  it('rejects DISCONNECT_REQUEST missing sessionId', async () => {
    const { handler, identity } = await makeHandler({ paired: true });
    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'DISCONNECT_REQUEST', {}),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sessionId/);
  });

  it('succeeds even without an active session (idempotent)', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    const result = await handler.handle(
      makeCommand(identity.get().deviceId, 'DISCONNECT_REQUEST', {
        sessionId: 'non-existent-session',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.['ended']).toBe(true);
  });

  it('stops an active session', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    // Start a session first
    await handler.handle(
      makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
        sessionId: 'stop-me', sessionToken: 'tok',
      }),
    );
    expect(sessionProvider.isSessionActive('stop-me')).toBe(true);

    // Disconnect
    const stopResult = await handler.handle(
      makeCommand(identity.get().deviceId, 'DISCONNECT_REQUEST', {
        sessionId: 'stop-me',
      }),
    );
    expect(stopResult.success).toBe(true);
    expect(sessionProvider.isSessionActive('stop-me')).toBe(false);
  });

  it('session becomes inactive after disconnect', async () => {
    const sessionProvider = new MockSessionProvider();
    const { handler, identity } = await makeHandler({ sessionProvider, paired: true });

    await handler.handle(makeCommand(identity.get().deviceId, 'CONNECT_REQUEST', {
      sessionId: 'to-stop', sessionToken: 'tok',
    }));

    await handler.handle(makeCommand(identity.get().deviceId, 'DISCONNECT_REQUEST', {
      sessionId: 'to-stop',
    }));

    expect(sessionProvider.isSessionActive('to-stop')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5 — MockSessionProvider unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe('MockSessionProvider', () => {
  it('startSession returns mock SessionInfo', async () => {
    const provider = new MockSessionProvider();
    const info = await provider.startSession({
      sessionId:    'test-123',
      sessionToken: 'tok-never-log',
      backendUrl:   'http://localhost:3001',
      deviceId:     'dev-001',
    });

    expect(info.sessionId).toBe('test-123');
    expect(info.sessionType).toBe('mock');
    expect(info.wsProxyPath).toBe('/api/sessions/test-123/ws');
    expect(info.vncHost).toBe('localhost');
    expect(info.vncPort).toBe(5900);
  });

  it('isSessionActive returns true after start', async () => {
    const provider = new MockSessionProvider();
    await provider.startSession({ sessionId: 's1', sessionToken: 't', backendUrl: '', deviceId: 'd' });
    expect(provider.isSessionActive('s1')).toBe(true);
  });

  it('isSessionActive returns false after stop', async () => {
    const provider = new MockSessionProvider();
    await provider.startSession({ sessionId: 's2', sessionToken: 't', backendUrl: '', deviceId: 'd' });
    await provider.stopSession('s2');
    expect(provider.isSessionActive('s2')).toBe(false);
  });

  it('isSessionActive returns false for unknown session', () => {
    const provider = new MockSessionProvider();
    expect(provider.isSessionActive('unknown')).toBe(false);
  });

  it('sessionToken is not stored in returned SessionInfo', async () => {
    const provider = new MockSessionProvider();
    const info = await provider.startSession({
      sessionId: 'sec-test', sessionToken: 'super-secret-token',
      backendUrl: '', deviceId: 'd',
    });
    expect(JSON.stringify(info)).not.toContain('super-secret-token');
  });
});
