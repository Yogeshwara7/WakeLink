/**
 * ApiWakeService — real WakeService implementation (Phase 3).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Mock (current):   src/services/mock/MockWakeService.ts
 * Real (this file): src/services/api/ApiWakeService.ts
 *
 * Phase 3 flow:
 *   sendWakeRequest()  → POST /api/devices/:id/wake
 *                        Backend sends the UDP magic packet.
 *   waitForOnline()    → polls GET /api/devices/:id every 5 s
 *                        until status === 'ONLINE' or timeout.
 *
 * TO ACTIVATE: In src/services/index.ts replace:
 *   new MockWakeService()
 * with:
 *   new ApiWakeService(apiClient)
 * ─────────────────────────────────────────────────────────────────────
 *
 * UI visible sequence (driven by MockConnectionService / ApiConnectionService):
 *   Checking PC → PC Offline → Sending Wake Request
 *   → Waiting for PC → PC Online → Connecting → Connected
 */

import type { WakeService } from '../WakeService';
import type { ApiClient } from './ApiClient';

interface WakeResponse {
  success: boolean;
  deviceId: string;
  wakeStatus: string;
  lastWakeRequestedAt: string;
  message?: string;
  error?: string;
}

interface DeviceStatusResponse {
  device: {
    status: string;
    wakeStatus?: string;
    lastHeartbeatAt: string | null;
  };
}

const POLL_INTERVAL_MS   = 5_000;
const DEFAULT_TIMEOUT_MS = 120_000;   // match backend WOL_WAKE_TIMEOUT_MS default

/** Status messages shown in the mobile connection state machine. */
const POLL_MESSAGES = [
  'Wake packet sent. Waiting for PC to start up…',
  'PC is starting up…',
  'Waiting for PC to come online…',
  'Almost there…',
];

export class ApiWakeService implements WakeService {
  constructor(private readonly client: ApiClient) {}

  /**
   * Sends a wake request to the backend.
   * The backend validates MAC/wakeSupported and fires the UDP magic packet.
   * Resolves when the request has been dispatched (not when the PC is online).
   */
  async sendWakeRequest(deviceId: string): Promise<void> {
    const res = await this.client.post<WakeResponse>(
      `/api/devices/${deviceId}/wake`,
      {},
    );
    if (!res.success) {
      throw new Error(res.error ?? 'Wake request failed');
    }
  }

  /**
   * Polls until the device is ONLINE or the timeout elapses.
   * Reports progress via onStatusChange so the connection state machine
   * can update the UI without any screen changes.
   */
  async waitForOnline(
    deviceId: string,
    onStatusChange: (message: string) => void,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const deadline  = Date.now() + timeoutMs;
    let   msgIndex  = 0;

    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);

      onStatusChange(POLL_MESSAGES[Math.min(msgIndex++, POLL_MESSAGES.length - 1)]);

      try {
        const res = await this.client.get<DeviceStatusResponse>(
          `/api/devices/${deviceId}`,
        );

        if (res.device.status === 'ONLINE') return;

        // Backend reported wake failed
        if (res.device.wakeStatus === 'FAILED') {
          throw new Error(
            'Wake-on-LAN failed. The PC did not respond in time. ' +
            'Check that WoL is enabled in BIOS and Windows Device Manager.',
          );
        }
      } catch (err) {
        // Re-throw only hard failures; network errors keep polling
        if (
          err instanceof Error &&
          err.message.startsWith('Wake-on-LAN failed')
        ) {
          throw err;
        }
        // Transient network error — keep polling
      }
    }

    throw new Error(
      'Wake timeout — PC did not come online within the expected time. ' +
      'Verify BIOS and network adapter Wake-on-LAN settings.',
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
