/**
 * ApiWakeService — real implementation of WakeService.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Mock implementation (current):   src/services/mock/MockWakeService.ts
 * Real implementation (this file): src/services/api/ApiWakeService.ts
 *
 * How it works (Phase 3+):
 *   sendWakeRequest()  → POST /api/devices/:id/commands { type: 'WAKE_REQUEST' }
 *   waitForOnline()    → polls GET /api/devices/:id until status === 'ONLINE'
 *
 * TO ACTIVATE: In src/services/index.ts, replace:
 *   new MockWakeService()
 * with:
 *   new ApiWakeService(apiClient)
 * ─────────────────────────────────────────────────────────────────────
 *
 * NOTE: WAKE_REQUEST is defined in the CommandHandler but not yet
 * implemented in the agent. This service is ready for when it is.
 */

import type { WakeService } from '../WakeService';
import type { ApiClient } from './ApiClient';

interface DeviceStatusResponse {
  device: { status: string; lastHeartbeatAt: string | null };
}

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 90_000;

export class ApiWakeService implements WakeService {
  constructor(private readonly client: ApiClient) {}

  async sendWakeRequest(deviceId: string): Promise<void> {
    await this.client.post(`/api/devices/${deviceId}/commands`, {
      type:    'WAKE_REQUEST',
      payload: {},
    });
  }

  async waitForOnline(
    deviceId: string,
    onStatusChange: (message: string) => void,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const messages = [
      'Wake request sent…',
      'Waiting for PC to start up…',
      'Checking if PC is reachable…',
    ];
    let msgIndex = 0;

    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);

      onStatusChange(messages[Math.min(msgIndex++, messages.length - 1)]);

      try {
        const res = await this.client.get<DeviceStatusResponse>(
          `/api/devices/${deviceId}`,
        );
        if (res.device.status === 'ONLINE') return;
      } catch {
        // Network error — keep polling
      }
    }

    throw new Error('Wake timeout — PC did not come online in time.');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
