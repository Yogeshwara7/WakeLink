import type { WakeService } from '../WakeService';

const WAKE_SEQUENCE_MS = [
  { delay: 1200, message: 'Wake request sent...' },
  { delay: 2500, message: 'Waiting for PC to respond...' },
  { delay: 4000, message: 'PC is starting up...' },
  { delay: 5500, message: 'Almost there...' },
];

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * MockWakeService — simulates sending a wake request and polling for online state.
 *
 * Replace with WoLWakeService (magic packet via cloud relay) or
 * HardwareWakeService (USB out-of-band controller) without touching UI code.
 */
export class MockWakeService implements WakeService {
  async sendWakeRequest(deviceId: string): Promise<void> {
    console.log(`[MockWakeService] Sending wake request for ${deviceId}`);
    await delay(400);
  }

  async waitForOnline(
    deviceId: string,
    onStatusChange: (message: string) => void,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (const step of WAKE_SEQUENCE_MS) {
      if (Date.now() > deadline) {
        throw new Error('Wake timeout — PC did not come online in time.');
      }
      await delay(step.delay);
      onStatusChange(step.message);
    }

    // Final check — still within timeout?
    if (Date.now() > deadline) {
      throw new Error('Wake timeout — PC did not come online in time.');
    }

    console.log(`[MockWakeService] Device ${deviceId} is now online (mock)`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
