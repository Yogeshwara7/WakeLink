import type { Device, DeviceUpdate } from '../models/Device';

/**
 * DeviceService — manages the list of registered PCs for the current user.
 *
 * Swap MockDeviceService for a real implementation backed by the WakeLink
 * Cloud API without changing any screen code.
 */
export interface DeviceService {
  /** Returns all devices registered to the current user. */
  getDevices(): Promise<Device[]>;

  /** Returns a single device by its stable ID. */
  getDevice(id: string): Promise<Device | null>;

  /**
   * Applies a partial update to a device (e.g. rename, status change).
   * Returns the updated device.
   */
  updateDevice(id: string, update: DeviceUpdate): Promise<Device>;

  /** Removes a paired device from the user's account. */
  removeDevice(id: string): Promise<void>;

  /**
   * Subscribe to live status updates for a specific device.
   * The callback fires whenever the device's status changes.
   * Returns an unsubscribe function.
   *
   * Real implementation: WebSocket / SSE push from WakeLink Cloud.
   */
  subscribeToDevice(
    id: string,
    callback: (device: Device) => void,
  ): () => void;
}
