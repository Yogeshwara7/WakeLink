import type { DeviceService } from '../DeviceService';
import type { Device, DeviceUpdate } from '../../models/Device';
import { DeviceStatus } from '../../models/Device';

/** Seed data — represents two already-paired PCs. */
const SEED_DEVICES: Device[] = [
  {
    id: 'device-001',
    name: 'Home Laptop',
    status: DeviceStatus.OFFLINE,
    lastSeen: new Date(Date.now() - 1000 * 60 * 47).toISOString(), // 47 min ago
    platform: 'windows',
    capabilities: {
      wakeOnLan: true,
      hardwareWake: false,
      remoteDesktop: true,
    },
  },
  {
    id: 'device-002',
    name: 'Gaming PC',
    status: DeviceStatus.ONLINE,
    lastSeen: new Date().toISOString(),
    platform: 'windows',
    capabilities: {
      wakeOnLan: true,
      hardwareWake: false,
      remoteDesktop: true,
    },
  },
];

/**
 * MockDeviceService — in-memory device list for UI development.
 *
 * Replace with a real implementation that calls the WakeLink Cloud API.
 * The mock intentionally uses simple async delays to simulate network latency.
 */
export class MockDeviceService implements DeviceService {
  private devices: Device[] = SEED_DEVICES.map((d) => ({ ...d }));
  private subscribers: Map<string, Set<(device: Device) => void>> = new Map();

  async getDevices(): Promise<Device[]> {
    await delay(300);
    return this.devices.map((d) => ({ ...d }));
  }

  async getDevice(id: string): Promise<Device | null> {
    await delay(150);
    return this.devices.find((d) => d.id === id) ?? null;
  }

  async updateDevice(id: string, update: DeviceUpdate): Promise<Device> {
    await delay(200);
    const idx = this.devices.findIndex((d) => d.id === id);
    if (idx === -1) throw new Error(`Device ${id} not found`);
    this.devices[idx] = { ...this.devices[idx], ...update };
    this._notify(id, this.devices[idx]);
    return { ...this.devices[idx] };
  }

  async removeDevice(id: string): Promise<void> {
    await delay(200);
    this.devices = this.devices.filter((d) => d.id !== id);
    this.subscribers.delete(id);
  }

  subscribeToDevice(id: string, callback: (device: Device) => void): () => void {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    this.subscribers.get(id)!.add(callback);
    return () => {
      this.subscribers.get(id)?.delete(callback);
    };
  }

  /** Called internally by MockConnectionService to push status changes. */
  _pushStatus(id: string, status: DeviceStatus): void {
    const idx = this.devices.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.devices[idx] = {
      ...this.devices[idx],
      status,
      lastSeen: status === DeviceStatus.ONLINE ? new Date().toISOString() : this.devices[idx].lastSeen,
    };
    this._notify(id, this.devices[idx]);
  }

  /** Add a freshly-paired device (called by MockPairingService). */
  _addDevice(device: Device): void {
    this.devices.push({ ...device });
  }

  private _notify(id: string, device: Device): void {
    this.subscribers.get(id)?.forEach((cb) => cb({ ...device }));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
