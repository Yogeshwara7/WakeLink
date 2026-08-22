import * as path from 'path';
import * as os from 'os';

/**
 * Config — single source of truth for all agent configuration.
 *
 * Values are read from environment variables (populated by dotenv in dev,
 * or set by the system in production). Defaults are provided for every value
 * so the agent can start without a .env file.
 *
 * SECURITY: Never put secrets, API keys, or tokens here.
 *           Secrets are managed by SecureStorage.
 */
export interface AgentConfig {
  /** URL of the WakeLink backend (dev: localhost, prod: cloud URL). */
  backendUrl: string;

  /** How often the agent sends a heartbeat, in milliseconds. */
  heartbeatIntervalMs: number;

  /** How long a pairing code is valid, in milliseconds. */
  pairingExpiryMs: number;

  /** Semver version string — set at build time. */
  agentVersion: string;

  /** Directory where the identity file is stored. */
  storageDir: string;

  /** Whether to emit verbose debug logs. */
  debug: boolean;
}

function getStorageDir(): string {
  // Windows: %LOCALAPPDATA%\WakeLink
  // fallback: ~/.wakelink
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    return path.join(localAppData, 'WakeLink');
  }
  return path.join(os.homedir(), '.wakelink');
}

export function loadConfig(): AgentConfig {
  return {
    backendUrl:
      process.env['WAKELINK_BACKEND_URL'] ?? 'http://localhost:3001',

    heartbeatIntervalMs: parseInt(
      process.env['WAKELINK_HEARTBEAT_INTERVAL_MS'] ?? '30000',
      10,
    ),

    pairingExpiryMs: parseInt(
      process.env['WAKELINK_PAIRING_EXPIRY_MS'] ?? '300000',
      10,
    ),

    agentVersion:
      process.env['WAKELINK_AGENT_VERSION'] ?? '0.1.0',

    storageDir:
      process.env['WAKELINK_STORAGE_DIR'] ?? getStorageDir(),

    debug: process.env['WAKELINK_DEBUG'] === 'true',
  };
}
