/**
 * ⚠️  DEVELOPMENT ONLY — in-memory store, data is lost on restart.
 *
 * Replace with a real database (Postgres, SQLite, etc.) when building
 * the production WakeLink Cloud backend.
 */

export interface StoredDevice {
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
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'WAKING' | 'FAILED';
  lastHeartbeatAt: string | null;
  registeredAt: string;
  pairedUserId: string | null;

  // ── Phase 3: Wake-on-LAN fields ──────────────────────────────────────────
  /** Primary network adapter MAC address — used to send the magic packet. */
  macAddress?: string;
  /**
   * True only when BIOS and network adapter both support Wake-on-LAN.
   * Defaults to false — agent must explicitly set this to true.
   */
  wakeSupported?: boolean;
  /** Current state of the most recent wake cycle. */
  wakeStatus?: 'IDLE' | 'WAKING' | 'ONLINE' | 'FAILED';
  /** ISO-8601 timestamp of the most recent wake request. */
  lastWakeRequestedAt?: string;
}

export interface StoredPairingSession {
  sessionId: string;
  deviceId: string;
  pairingCode: string;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
}

export interface StoredCommand {
  commandId: string;
  deviceId: string;
  type: string;
  timestamp: string;
  expiresAt: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  processedAt: string | null;
}

/**
 * DeviceStore — the single in-memory data store for the dev backend.
 *
 * All state lives here. No persistence between restarts by design
 * (keeps the dev environment clean and stateless).
 */
export class DeviceStore {
  private static instance: DeviceStore;

  readonly devices   = new Map<string, StoredDevice>();
  readonly pairing   = new Map<string, StoredPairingSession>();
  readonly commands  = new Map<string, StoredCommand>();

  /** Active WAKING-timeout timers keyed by deviceId. */
  private readonly wakeTimers = new Map<string, NodeJS.Timeout>();

  static getInstance(): DeviceStore {
    if (!DeviceStore.instance) {
      DeviceStore.instance = new DeviceStore();
    }
    return DeviceStore.instance;
  }

  /** Mark a device as offline if its last heartbeat is stale (> 2 minutes). */
  pruneStaleDevices(): void {
    const staleThresholdMs = 2 * 60 * 1000;
    const now = Date.now();
    for (const device of this.devices.values()) {
      if (
        device.status === 'ONLINE' &&
        device.lastHeartbeatAt &&
        now - new Date(device.lastHeartbeatAt).getTime() > staleThresholdMs
      ) {
        device.status = 'OFFLINE';
      }
    }
  }

  /**
   * Start a WAKING timeout for a device.
   * If no heartbeat arrives within timeoutMs the wakeStatus transitions to FAILED.
   *
   * Calling this again cancels any existing timer for the same device.
   *
   * @param deviceId   Target device.
   * @param timeoutMs  Default: 120 000 ms (2 minutes).
   */
  startWakeTimeout(deviceId: string, timeoutMs = 120_000): void {
    // Cancel any existing timer first
    this.cancelWakeTimeout(deviceId);

    const timer = setTimeout(() => {
      const device = this.devices.get(deviceId);
      if (device && device.status === 'WAKING') {
        device.status     = 'OFFLINE';
        device.wakeStatus = 'FAILED';
        console.log(
          `[WAKE] Timeout — device ${deviceId} did not come online within ${timeoutMs / 1000}s`,
        );
      }
      this.wakeTimers.delete(deviceId);
    }, timeoutMs);

    this.wakeTimers.set(deviceId, timer);
  }

  /** Cancel a pending wake timeout (called when heartbeat arrives). */
  cancelWakeTimeout(deviceId: string): void {
    const existing = this.wakeTimers.get(deviceId);
    if (existing) {
      clearTimeout(existing);
      this.wakeTimers.delete(deviceId);
    }
  }
}
