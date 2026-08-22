import * as http from 'http';
import * as https from 'https';
import type { IdentityManager } from '../identity/IdentityManager';
import type { AgentStateManager } from '../agent/AgentState';
import type { AgentConfig } from '../config/Config';
import { SystemInfo } from '../system/SystemInfo';
import { NetworkInfo } from '../system/NetworkInfo';
import { Logger } from '../utils/Logger';

/**
 * HeartbeatPayload — what the agent sends to the backend on every tick.
 *
 * Kept minimal — only information the backend needs to track presence.
 * MAC addresses are NOT included in the heartbeat (only used for WoL, future).
 */
export interface HeartbeatPayload {
  deviceId: string;
  agentVersion: string;
  timestamp: string;
  status: 'ONLINE' | 'OFFLINE' | 'SLEEPING' | 'UNKNOWN';
  networkAvailable: boolean;
  os: string;
  osVersion: string;
  uptimeSeconds: number;
}

/**
 * HeartbeatManager — periodically reports the agent's presence to the backend.
 *
 * Interval: configurable, default 30 seconds.
 * Handles temporary network loss gracefully — logs a warning but keeps running.
 *
 * Real implementation: POST to /api/devices/:deviceId/heartbeat
 * Future: replace HTTP polling with a persistent WebSocket channel.
 */
export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private readonly log = Logger.getInstance();
  private consecutiveFailures = 0;
  private readonly MAX_FAILURES_BEFORE_RECONNECT = 3;

  constructor(
    private readonly identityManager: IdentityManager,
    private readonly stateManager: AgentStateManager,
    private readonly config: AgentConfig,
  ) {}

  /** Start sending heartbeats. Sends one immediately, then on interval. */
  start(): void {
    if (this.timer) return; // already running
    this.log.info(
      `Heartbeat started (interval: ${this.config.heartbeatIntervalMs / 1000}s)`,
    );
    // Send immediately on start
    this.sendHeartbeat();
    this.timer = setInterval(
      () => this.sendHeartbeat(),
      this.config.heartbeatIntervalMs,
    );
  }

  /** Stop sending heartbeats. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info('Heartbeat stopped');
    }
  }

  /** Build the payload for this tick. */
  buildPayload(): HeartbeatPayload {
    const identity = this.identityManager.get();
    const system = SystemInfo.capture();
    return {
      deviceId:         identity.deviceId,
      agentVersion:     identity.agentVersion,
      timestamp:        new Date().toISOString(),
      status:           'ONLINE',
      networkAvailable: NetworkInfo.isNetworkAvailable(),
      os:               system.platform,
      osVersion:        system.osVersion,
      uptimeSeconds:    system.uptimeSeconds,
    };
  }

  private async sendHeartbeat(): Promise<void> {
    if (
      this.stateManager.is('STOPPING') ||
      this.stateManager.is('ERROR')
    ) return;

    const identity = this.identityManager.get();
    const payload  = this.buildPayload();
    const url      = `${this.config.backendUrl}/api/devices/${identity.deviceId}/heartbeat`;

    try {
      await this.httpPost(url, payload);
      this.consecutiveFailures = 0;
      await this.identityManager.touchLastSeen();
      this.log.info(`Heartbeat sent`);
    } catch (err) {
      this.consecutiveFailures++;
      this.log.warn(
        `Heartbeat failed (${this.consecutiveFailures}/${this.MAX_FAILURES_BEFORE_RECONNECT}): ` +
        (err instanceof Error ? err.message : String(err)),
      );

      if (
        this.consecutiveFailures >= this.MAX_FAILURES_BEFORE_RECONNECT &&
        this.stateManager.is('ONLINE')
      ) {
        try {
          this.stateManager.transition('RECONNECTING');
        } catch {
          // State may have already changed
        }
      }
    }
  }

  /** Minimal HTTP/HTTPS POST using Node built-ins — no axios/fetch needed. */
  private httpPost(url: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const data    = JSON.stringify(body);
      const parsed  = new URL(url);
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
        // Drain response body to free socket
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
      });

      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy(new Error('Heartbeat request timed out'));
      });
      req.write(data);
      req.end();
    });
  }
}
