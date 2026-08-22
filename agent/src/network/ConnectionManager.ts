import * as http from 'http';
import * as https from 'https';
import type { IdentityManager } from '../identity/IdentityManager';
import type { AgentStateManager } from '../agent/AgentState';
import type { AgentConfig } from '../config/Config';
import { SystemInfo } from '../system/SystemInfo';
import { NetworkInfo } from '../system/NetworkInfo';
import { Logger } from '../utils/Logger';

/**
 * DeviceRegistrationPayload — sent to the backend when the agent connects.
 *
 * Phase 3 additions:
 *   macAddress    — primary adapter MAC for Wake-on-LAN.
 *   wakeSupported — explicitly false until BIOS/NIC confirmed by the user.
 */
export interface DeviceRegistrationPayload {
  deviceId: string;
  deviceName: string;
  platform: string;
  agentVersion: string;
  os: string;
  osVersion: string;
  capabilities: {
    wakeOnLan: boolean;
    hardwareWake: boolean;
    remoteDesktop: boolean;
  };
  macAddress?: string;
  wakeSupported: boolean;
  /**
   * Phase 4: relayId of the WakeLink Home Relay on this network.
   * Set via WAKELINK_RELAY_ID env var after the relay is installed.
   * null when no relay is configured.
   */
  relayId?: string | null;
}

/**
 * ConnectionManager — manages the agent's connection to the backend.
 *
 * Current implementation:
 *   HTTP REST (register on connect, heartbeat via HeartbeatManager).
 *
 * Future implementation:
 *   Persistent WebSocket connection — the agent initiates an OUTBOUND
 *   connection to WakeLink Cloud. No inbound ports are required on the
 *   user's router. The cloud pushes commands down the open socket.
 *
 * Design principle:
 *   The agent ALWAYS makes outbound connections. The backend never
 *   initiates a direct connection to the agent. This eliminates the
 *   need for router port forwarding.
 */
export class ConnectionManager {
  private readonly log = Logger.getInstance();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly RECONNECT_DELAY_MS = 15_000;

  constructor(
    private readonly identityManager: IdentityManager,
    private readonly stateManager: AgentStateManager,
    private readonly config: AgentConfig,
  ) {
    // Auto-reconnect when the state machine signals a lost connection
    this.stateManager.onChange((_prev, next) => {
      if (next === 'RECONNECTING') {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Connect to the backend.
   * Registers this device and transitions to ONLINE on success.
   * Transitions to OFFLINE on failure (agent still runs — heartbeat will retry).
   */
  async connect(): Promise<void> {
    const identity = this.identityManager.get();

    // Only transition if we're in a state where CONNECTING is valid
    if (
      this.stateManager.is('UNPAIRED') ||
      this.stateManager.is('PAIRING') ||
      this.stateManager.is('INITIALISING')
    ) {
      this.stateManager.transition('CONNECTING');
    }

    const payload = this.buildRegistrationPayload();
    const url = `${this.config.backendUrl}/api/devices/register`;

    try {
      await this.httpPost(url, payload);
      this.stateManager.transition('ONLINE');
      this.log.info(`Connected to development backend`);
      this.log.info(`Device registered: ${identity.deviceId}`);
    } catch (err) {
      this.log.warn(
        `Could not connect to backend (${this.config.backendUrl}): ` +
        (err instanceof Error ? err.message : String(err)),
      );
      this.log.warn(
        'Running in offline mode — heartbeats will retry when backend is available.',
      );
      try {
        this.stateManager.transition('OFFLINE');
      } catch {
        // State may already be appropriate
      }
    }
  }

  /** Gracefully disconnect — notify backend and clear timers. */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Future: send a disconnect notification to the backend via WebSocket close
    this.log.info('Disconnected from backend');
  }

  private buildRegistrationPayload(): DeviceRegistrationPayload {
    const identity   = this.identityManager.get();
    const system     = SystemInfo.capture();
    const interfaces = NetworkInfo.getActiveInterfaces();

    // Use the MAC of the first active non-internal adapter.
    // NEVER log this value.
    const primaryMac = interfaces.length > 0 ? interfaces[0].mac : undefined;

    return {
      deviceId:     identity.deviceId,
      deviceName:   identity.deviceName,
      platform:     identity.platform,
      agentVersion: identity.agentVersion,
      os:           system.platform,
      osVersion:    system.osVersion,
      capabilities: {
        wakeOnLan:     interfaces.length > 0,  // true if we have at least one NIC
        hardwareWake:  false,
        remoteDesktop: false,
      },
      macAddress:   primaryMac,
      wakeSupported: process.env['WAKELINK_WAKE_SUPPORTED'] === 'true',
      /**
       * If a WakeLink Home Relay is running on this network, set
       * WAKELINK_RELAY_ID in the agent's .env to associate this device
       * with that relay. The backend will then route wake requests through it.
       */
      relayId: process.env['WAKELINK_RELAY_ID'] ?? null,
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.log.info(
      `Reconnecting in ${this.RECONNECT_DELAY_MS / 1000}s...`,
    );
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, this.RECONNECT_DELAY_MS);
  }

  /** Minimal HTTP POST — same pattern as HeartbeatManager to avoid deps. */
  private httpPost(url: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const data   = JSON.stringify(body);
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = (isHttps ? https : http).request(options, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
      });

      req.on('error', reject);
      req.setTimeout(10_000, () => req.destroy(new Error('Request timed out')));
      req.write(data);
      req.end();
    });
  }
}
