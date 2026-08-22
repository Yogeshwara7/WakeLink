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
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  lastHeartbeatAt: string | null;
  registeredAt: string;
  pairedUserId: string | null;
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
}
