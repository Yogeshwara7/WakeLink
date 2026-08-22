import type {
  WakeRelay,
  RelayCommand,
  RelayCommandResult,
} from '../interfaces/WakeRelay';
import { v4 as uuidv4 } from 'uuid';

/**
 * MockWakeRelay — in-memory implementation for unit tests.
 *
 * - register() returns a deterministic relayId/token.
 * - Commands can be injected via enqueueMockCommand().
 * - Results are captured in sentResults for assertion.
 * - No real UDP packets are sent.
 * - No network calls are made.
 */
export class MockWakeRelay implements WakeRelay {
  readonly mockRelayId    = 'mock-relay-001';
  readonly mockRelayToken = 'mock-token-001';

  private pendingCommands: RelayCommand[]   = [];
  readonly sentResults:    RelayCommandResult[] = [];
  readonly heartbeats:     number[] = [];
  readonly sentPackets:    { mac: string; broadcastAddress: string }[] = [];

  async register(
    _relayName: string,
    _deviceIds: string[],
  ): Promise<{ relayId: string; relayToken: string }> {
    return { relayId: this.mockRelayId, relayToken: this.mockRelayToken };
  }

  async heartbeat(
    _relayId: string,
    _relayToken: string,
    _deviceIds: string[],
  ): Promise<void> {
    this.heartbeats.push(Date.now());
  }

  async fetchPendingCommands(
    _relayId: string,
    _relayToken: string,
  ): Promise<RelayCommand[]> {
    const cmds = [...this.pendingCommands];
    this.pendingCommands = [];
    return cmds;
  }

  async reportResult(
    _relayId: string,
    _relayToken: string,
    result: RelayCommandResult,
  ): Promise<void> {
    this.sentResults.push(result);
  }

  /** Inject a wake command to be returned on next fetchPendingCommands(). */
  enqueueMockCommand(
    deviceId: string,
    macAddress: string,
    broadcastAddress = '255.255.255.255',
  ): RelayCommand {
    const now = new Date();
    const cmd: RelayCommand = {
      commandId:        uuidv4(),
      relayId:          this.mockRelayId,
      type:             'RELAY_WAKE',
      deviceId,
      macAddress,
      broadcastAddress,
      timestamp:        now.toISOString(),
      expiresAt:        new Date(now.getTime() + 120_000).toISOString(),
    };
    this.pendingCommands.push(cmd);
    return cmd;
  }

  reset(): void {
    this.pendingCommands = [];
    this.sentResults.length  = 0;
    this.heartbeats.length   = 0;
    this.sentPackets.length  = 0;
  }
}
