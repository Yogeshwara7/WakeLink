/**
 * ApiDeviceService — real implementation of DeviceService.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Mock implementation (current):   src/services/mock/MockDeviceService.ts
 * Real implementation (this file): src/services/api/ApiDeviceService.ts
 *
 * TO ACTIVATE: In src/services/index.ts, replace:
 *   new MockDeviceService()
 * with:
 *   new ApiDeviceService(apiClient)
 * ─────────────────────────────────────────────────────────────────────
 *
 * subscribeToDevice — currently implemented as polling.
 * Replace with a WebSocket/SSE subscription when the real backend
 * supports push notifications.
 */

import type { DeviceService } from '../DeviceService';
import type { Device, DeviceUpdate } from '../../models/Device';
import { DeviceStatus } from '../../models/Device';
import type { ApiClient } from './ApiClient';

interface BackendDevice {
  deviceId: string;
  deviceName: string;
  status: string;
  lastHeartbeatAt: string | null;
  platform: string;
  capabilities: {
    wakeOnLan: boolean;
    hardwareWake: boolean;
    remoteDesktop: boolean;
  };
}

interface DeviceListResponse  { devices: BackendDevice[] }
interface DeviceItemResponse  { device: BackendDevice }

/** Map backend status string → mobile DeviceStatus enum */
function toStatus(s: string): DeviceStatus {
  switch (s.toUpperCase()) {
    case 'ONLINE':     return DeviceStatus.ONLINE;
    case 'OFFLINE':    return DeviceStatus.OFFLINE;
    case 'CONNECTING': return DeviceStatus.CONNECTING;
    default:           return DeviceStatus.UNKNOWN;
  }
}

function toDevice(d: BackendDevice): Device {
  return {
    id:           d.deviceId,
    name:         d.deviceName,
    status:       toStatus(d.status),
    lastSeen:     d.lastHeartbeatAt,
    platform:     (d.platform as Device['platform']) ?? 'windows',
    capabilities: d.capabilities,
  };
}

const POLL_INTERVAL_MS = 10_000;

export class ApiDeviceService implements DeviceService {
  constructor(private readonly client: ApiClient) {}

  async getDevices(): Promise<Device[]> {
    const res = await this.client.get<DeviceListResponse>('/api/devices');
    return res.devices.map(toDevice);
  }

  async getDevice(id: string): Promise<Device | null> {
    try {
      const res = await this.client.get<DeviceItemResponse>(`/api/devices/${id}`);
      return toDevice(res.device);
    } catch {
      return null;
    }
  }

  async updateDevice(id: string, update: DeviceUpdate): Promise<Device> {
    // Real backend: PATCH /api/devices/:id
    // For now, read → apply update locally → return (backend not yet implemented)
    const device = await this.getDevice(id);
    if (!device) throw new Error(`Device ${id} not found`);
    return { ...device, ...update };
  }

  async removeDevice(id: string): Promise<void> {
    // Real backend: DELETE /api/devices/:id
    await this.client.post(`/api/devices/${id}/remove`, {});
  }

  subscribeToDevice(id: string, callback: (device: Device) => void): () => void {
    // Polling implementation — replace with WebSocket/SSE in Phase 3
    const timer = setInterval(async () => {
      try {
        const device = await this.getDevice(id);
        if (device) callback(device);
      } catch {
        // Network error — silently skip this tick
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }
}
