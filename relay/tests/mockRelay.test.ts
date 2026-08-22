import { MockWakeRelay } from '../src/mock/MockWakeRelay';
import { WolExecutor }   from '../src/relay/WolExecutor';

describe('MockWakeRelay', () => {
  let relay: MockWakeRelay;

  beforeEach(() => { relay = new MockWakeRelay(); });

  it('register() returns deterministic relayId and token', async () => {
    const result = await relay.register('Test Relay', []);
    expect(result.relayId).toBe(relay.mockRelayId);
    expect(result.relayToken).toBe(relay.mockRelayToken);
  });

  it('heartbeat() records timestamps', async () => {
    await relay.heartbeat(relay.mockRelayId, relay.mockRelayToken, []);
    expect(relay.heartbeats).toHaveLength(1);
    expect(relay.heartbeats[0]).toBeCloseTo(Date.now(), -3);
  });

  it('fetchPendingCommands() returns empty when nothing queued', async () => {
    const cmds = await relay.fetchPendingCommands(relay.mockRelayId, relay.mockRelayToken);
    expect(cmds).toHaveLength(0);
  });

  it('fetchPendingCommands() returns injected commands and clears queue', async () => {
    relay.enqueueMockCommand('device-001', 'AA:BB:CC:DD:EE:FF');
    relay.enqueueMockCommand('device-002', '11:22:33:44:55:66');

    const first = await relay.fetchPendingCommands(relay.mockRelayId, relay.mockRelayToken);
    expect(first).toHaveLength(2);

    // Queue should be cleared
    const second = await relay.fetchPendingCommands(relay.mockRelayId, relay.mockRelayToken);
    expect(second).toHaveLength(0);
  });

  it('reportResult() captures results', async () => {
    await relay.reportResult(relay.mockRelayId, relay.mockRelayToken, {
      commandId: 'cmd-001',
      success:   true,
    });
    expect(relay.sentResults).toHaveLength(1);
    expect(relay.sentResults[0].success).toBe(true);
    expect(relay.sentResults[0].commandId).toBe('cmd-001');
  });

  it('reset() clears all state', async () => {
    relay.enqueueMockCommand('dev', 'AA:BB:CC:DD:EE:FF');
    await relay.heartbeat(relay.mockRelayId, relay.mockRelayToken, []);
    await relay.reportResult(relay.mockRelayId, relay.mockRelayToken, {
      commandId: 'x', success: true,
    });

    relay.reset();
    const cmds = await relay.fetchPendingCommands(relay.mockRelayId, relay.mockRelayToken);
    expect(cmds).toHaveLength(0);
    expect(relay.heartbeats).toHaveLength(0);
    expect(relay.sentResults).toHaveLength(0);
  });

  it('enqueueMockCommand() sets correct command fields', () => {
    const cmd = relay.enqueueMockCommand('dev-001', 'AA:BB:CC:DD:EE:FF', '192.168.1.255');
    expect(cmd.type).toBe('RELAY_WAKE');
    expect(cmd.deviceId).toBe('dev-001');
    expect(cmd.macAddress).toBe('AA:BB:CC:DD:EE:FF');
    expect(cmd.broadcastAddress).toBe('192.168.1.255');
    expect(cmd.relayId).toBe(relay.mockRelayId);
    expect(new Date(cmd.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('WolExecutor', () => {
  it('normaliseMac accepts colon-separated MAC', () => {
    expect(WolExecutor.normaliseMac('aa:bb:cc:dd:ee:ff')).toBe('AABBCCDDEEFF');
  });

  it('normaliseMac returns null for invalid MAC', () => {
    expect(WolExecutor.normaliseMac('not-a-mac')).toBeNull();
  });

  it('buildMagicPacket returns 102 bytes', () => {
    const pkt = WolExecutor.buildMagicPacket('AA:BB:CC:DD:EE:FF');
    expect(pkt.length).toBe(102);
  });

  it('buildMagicPacket starts with 6×0xFF', () => {
    const pkt = WolExecutor.buildMagicPacket('AA:BB:CC:DD:EE:FF');
    for (let i = 0; i < 6; i++) expect(pkt[i]).toBe(0xff);
  });

  it('buildMagicPacket contains MAC repeated 16 times', () => {
    const pkt    = WolExecutor.buildMagicPacket('AA:BB:CC:DD:EE:FF');
    const macHex = Buffer.from('AABBCCDDEEFF', 'hex');
    for (let i = 0; i < 16; i++) {
      const slice = pkt.slice(6 + i * 6, 6 + i * 6 + 6);
      expect(slice.equals(macHex)).toBe(true);
    }
  });

  it('buildMagicPacket throws for invalid MAC', () => {
    expect(() => WolExecutor.buildMagicPacket('invalid')).toThrow(/Invalid MAC/);
  });
});
