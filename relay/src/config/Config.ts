export interface RelayConfig {
  backendUrl: string;
  relayId: string;
  relayToken: string;
  relayName: string;
  relayVersion: string;
  broadcastAddress: string;
  wolPort: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}

export function loadConfig(): RelayConfig {
  return {
    backendUrl:          process.env['WAKELINK_BACKEND_URL']        ?? 'http://localhost:3001',
    relayId:             process.env['WAKELINK_RELAY_ID']           ?? '',
    relayToken:          process.env['WAKELINK_RELAY_TOKEN']        ?? '',
    relayName:           process.env['WAKELINK_RELAY_NAME']         ?? 'Home Relay',
    relayVersion:        process.env['WAKELINK_RELAY_VERSION']      ?? '0.1.0',
    broadcastAddress:    process.env['WOL_BROADCAST_ADDRESS']       ?? '255.255.255.255',
    wolPort:             parseInt(process.env['WOL_PORT']           ?? '9', 10),
    pollIntervalMs:      parseInt(process.env['WAKELINK_POLL_INTERVAL_MS']      ?? '5000',  10),
    heartbeatIntervalMs: parseInt(process.env['WAKELINK_HEARTBEAT_INTERVAL_MS'] ?? '60000', 10),
  };
}
