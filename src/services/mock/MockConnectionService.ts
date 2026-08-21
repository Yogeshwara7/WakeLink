import type { ConnectionService } from '../ConnectionService';
import type { ConnectionSession } from '../../models/ConnectionSession';
import { ConnectionStep } from '../../models/ConnectionSession';
import { DeviceStatus } from '../../models/Device';
import type { MockDeviceService } from './MockDeviceService';
import type { WakeService } from '../WakeService';

/**
 * MockConnectionService — drives the full state machine with simulated delays.
 *
 * Replace with a real implementation that:
 *   1. Checks PC status via WakeLink Cloud API.
 *   2. Calls the real WakeService for offline devices.
 *   3. Initiates an actual RDP / streaming session for CONNECTING → CONNECTED.
 *
 * Dependencies are injected so the mock works without circular imports.
 */
export class MockConnectionService implements ConnectionService {
  constructor(
    private readonly devices: MockDeviceService,
    private readonly wake: WakeService,
  ) {}

  async connect(
    deviceId: string,
    onStepChange: (step: ConnectionStep, message: string) => void,
  ): Promise<ConnectionSession> {
    const startedAt = new Date().toISOString();

    const emit = (step: ConnectionStep, message: string) => onStepChange(step, message);

    // ── Step 1: Check current status ──────────────────────────────────────
    emit(ConnectionStep.CHECKING, 'Checking PC status…');
    await delay(800);

    const device = await this.devices.getDevice(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const isOnline = device.status === DeviceStatus.ONLINE;

    if (!isOnline) {
      // ── Offline path ────────────────────────────────────────────────────
      emit(ConnectionStep.PC_OFFLINE, 'PC is offline');
      await delay(600);

      emit(ConnectionStep.SENDING_WAKE, 'Sending wake request…');
      await this.wake.sendWakeRequest(deviceId);

      emit(ConnectionStep.WAITING_FOR_PC, 'Waiting for PC to come online…');
      await this.wake.waitForOnline(
        deviceId,
        (msg) => emit(ConnectionStep.WAITING_FOR_PC, msg),
      );

      this.devices._pushStatus(deviceId, DeviceStatus.ONLINE);
    }

    // ── PC is online ────────────────────────────────────────────────────
    emit(ConnectionStep.PC_ONLINE, 'PC is online');
    await delay(600);

    // ── Connecting ──────────────────────────────────────────────────────
    emit(ConnectionStep.CONNECTING, 'Establishing remote session…');
    await delay(1500);

    // ── Connected ───────────────────────────────────────────────────────
    emit(ConnectionStep.CONNECTED, 'Connected');
    this.devices._pushStatus(deviceId, DeviceStatus.CONNECTED);

    return {
      deviceId,
      step: ConnectionStep.CONNECTED,
      message: 'Connected',
      startedAt,
    };
  }

  async disconnect(deviceId: string): Promise<void> {
    await delay(300);
    this.devices._pushStatus(deviceId, DeviceStatus.ONLINE);
    console.log(`[MockConnectionService] Disconnected from ${deviceId}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
