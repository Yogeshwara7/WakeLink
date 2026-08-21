/**
 * Core device status values used across the entire app.
 * These are intentionally kept as a flat enum so UI components
 * can switch on them without importing business logic.
 */
export enum DeviceStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  WAKING = 'WAKING',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Capability flags that a device may or may not support.
 * New capabilities (e.g. hardwareWake via USB controller) can
 * be added here without touching existing code paths.
 */
export interface DeviceCapabilities {
  wakeOnLan: boolean;
  /** Future: out-of-band USB hardware wake controller */
  hardwareWake: boolean;
  remoteDesktop: boolean;
}

/**
 * The canonical Device model shared by services and UI.
 * - `id`       Internal stable identity (never shown as-is in main UI).
 * - `name`     User-facing friendly name.
 * - `status`   Current reachability / session state.
 * - `lastSeen` ISO-8601 timestamp; null when never seen.
 * - `platform` OS family — e.g. "windows", "mac", "linux".
 * - `capabilities` Feature flags; do NOT assume all are true.
 */
export interface Device {
  id: string;
  name: string;
  status: DeviceStatus;
  lastSeen: string | null;
  platform: 'windows' | 'mac' | 'linux' | 'unknown';
  capabilities: DeviceCapabilities;
}

/** Partial update payload — keeps services clean when only one field changes. */
export type DeviceUpdate = Partial<Omit<Device, 'id'>>;
