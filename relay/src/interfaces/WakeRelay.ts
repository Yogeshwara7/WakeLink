/**
 * WakeRelay — interface for the relay transport layer.
 *
 * Current implementation:  HttpWakeRelay (long-polling)
 * Future implementation:   WebSocketWakeRelay (persistent connection, 0-latency)
 *
 * Swapping the transport requires only changing the concrete class
 * instantiated in Relay.ts — nothing else changes.
 */

export interface RelayCommand {
  commandId: string;
  relayId: string;
  type: 'RELAY_WAKE';
  deviceId: string;
  macAddress: string;
  broadcastAddress: string;
  timestamp: string;
  expiresAt: string;
}

export interface RelayCommandResult {
  commandId: string;
  success: boolean;
  error?: string;
}

export interface WakeRelay {
  /**
   * Register this relay with the backend.
   * Called on first start or when relayId/token are not yet persisted.
   * Returns the assigned relayId and token.
   */
  register(relayName: string, deviceIds: string[]): Promise<{
    relayId: string;
    relayToken: string;
  }>;

  /** Send a heartbeat to the backend. */
  heartbeat(relayId: string, relayToken: string, deviceIds: string[]): Promise<void>;

  /**
   * Fetch pending RELAY_WAKE commands from the backend.
   * Long-polling implementation: short GET with immediate return.
   * WebSocket implementation: commands pushed via message event.
   */
  fetchPendingCommands(relayId: string, relayToken: string): Promise<RelayCommand[]>;

  /**
   * Report the result of executing a command back to the backend.
   */
  reportResult(
    relayId: string,
    relayToken: string,
    result: RelayCommandResult,
  ): Promise<void>;
}
