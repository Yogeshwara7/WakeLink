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
  macAddress?: string;
  wakeSupported?: boolean;
  wakeStatus?: 'IDLE' | 'WAKING' | 'ONLINE' | 'FAILED';
  lastWakeRequestedAt?: string;

  // ── Phase 4: Relay association ────────────────────────────────────────────
  /**
   * The relayId of the WakeLink Home Relay that can wake this device.
   * Set when the relay registers and declares the devices it can reach.
   * null = no relay configured; wake only works on same LAN as backend.
   */
  relayId?: string | null;
}

// ── Phase 4: Relay types ────────────────────────────────────────────────────

export type RelayStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

/**
 * StoredRelay — represents a WakeLink Home Relay registered with the backend.
 *
 * The relay is an always-on process running inside the home network.
 * It polls the backend for RELAY_WAKE commands and executes them locally
 * via UDP broadcast (WakeOnLanService).
 *
 * SECURITY:
 *   relayTokenHash stores a SHA-256 hash of the relay's secret token.
 *   The raw token is only ever held by the relay process and never logged.
 */
export interface StoredRelay {
  relayId: string;
  /** SHA-256 hash of the relay's secret token — never store raw token. */
  relayTokenHash: string;
  /** Friendly name for the relay (e.g. "Home Raspberry Pi"). */
  relayName: string;
  relayVersion: string;
  status: RelayStatus;
  lastHeartbeatAt: string | null;
  registeredAt: string;
  /** deviceIds this relay is responsible for waking. */
  deviceIds: string[];
  /** Broadcast address this relay should use for WoL packets. */
  broadcastAddress: string;
}

/**
 * StoredRelayCommand — a command queued for a relay to execute.
 */
export interface StoredRelayCommand {
  commandId: string;
  relayId: string;
  type: 'RELAY_WAKE';
  deviceId: string;
  macAddress: string;
  broadcastAddress: string;
  timestamp: string;
  expiresAt: string;
  processedAt: string | null;
  result: { success: boolean; error?: string } | null;
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
 */
export class DeviceStore {
  private static instance: DeviceStore;

  readonly devices        = new Map<string, StoredDevice>();
  readonly pairing        = new Map<string, StoredPairingSession>();
  readonly commands       = new Map<string, StoredCommand>();
  /** Phase 4: relay registry */
  readonly relays         = new Map<string, StoredRelay>();
  /** Phase 4: commands queued for relay execution */
  readonly relayCommands  = new Map<string, StoredRelayCommand>();

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

  // ── Phase 4: Relay helpers ────────────────────────────────────────────────

  /**
   * Returns the relay associated with a device, or null.
   * Also checks if the relay is online (recent heartbeat ≤ 90s).
   */
  getRelayForDevice(deviceId: string): StoredRelay | null {
    const device = this.devices.get(deviceId);
    if (!device?.relayId) return null;
    return this.relays.get(device.relayId) ?? null;
  }

  /** Returns true if the relay has sent a heartbeat within the last 90 seconds. */
  isRelayOnline(relay: StoredRelay): boolean {
    if (!relay.lastHeartbeatAt) return false;
    const age = Date.now() - new Date(relay.lastHeartbeatAt).getTime();
    return age < 90_000;
  }

  /** Mark stale relays as OFFLINE (called on /health and /debug). */
  pruneStaleRelays(): void {
    for (const relay of this.relays.values()) {
      if (relay.status === 'ONLINE' && !this.isRelayOnline(relay)) {
        relay.status = 'OFFLINE';
      }
    }
  }
}
