/**
 * ApiConnectionService — real implementation of ConnectionService.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Mock implementation (current):   src/services/mock/MockConnectionService.ts
 * Real implementation (this file): src/services/api/ApiConnectionService.ts
 *
 * TO ACTIVATE: In src/services/index.ts, replace:
 *   new MockConnectionService(deviceService, wakeService)
 * with:
 *   new ApiConnectionService(apiClient, apiDeviceService, apiWakeService)
 * ─────────────────────────────────────────────────────────────────────
 *
 * The state machine is identical to MockConnectionService.
 * The difference is that each step calls real backend endpoints
 * instead of simulating with setTimeout.
 */

import type { ConnectionService } from '../ConnectionService';
import type { ConnectionSession } from '../../models/ConnectionSession';
import { ConnectionStep } from '../../models/ConnectionSession';
import { DeviceStatus } from '../../models/Device';
import type { ApiClient } from './ApiClient';
import type { DeviceService } from '../DeviceService';
import type { WakeService } from '../WakeService';

export class ApiConnectionService implements ConnectionService {
  constructor(
    private readonly client: ApiClient,
    private readonly devices: DeviceService,
    private readonly wake: WakeService,
  ) {}

  async connect(
    deviceId: string,
    onStepChange: (step: ConnectionStep, message: string) => void,
  ): Promise<ConnectionSession> {
    const startedAt = new Date().toISOString();
    const emit = (step: ConnectionStep, message: string) =>
      onStepChange(step, message);

    // ── Step 1: Check status ───────────────────────────────────────────
    emit(ConnectionStep.CHECKING, 'Checking PC status…');
    const device = await this.devices.getDevice(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const isOnline = device.status === DeviceStatus.ONLINE;

    if (!isOnline) {
      // ── Offline path ─────────────────────────────────────────────────
      emit(ConnectionStep.PC_OFFLINE, 'PC is offline');

      emit(ConnectionStep.SENDING_WAKE, 'Sending wake request…');
      await this.wake.sendWakeRequest(deviceId);

      emit(ConnectionStep.WAITING_FOR_PC, 'Waiting for PC to come online…');
      await this.wake.waitForOnline(
        deviceId,
        (msg) => emit(ConnectionStep.WAITING_FOR_PC, msg),
      );
    }

    // ── PC is online ───────────────────────────────────────────────────
    emit(ConnectionStep.PC_ONLINE, 'PC is online');

    // ── Connecting ────────────────────────────────────────────────────
    emit(ConnectionStep.CONNECTING, 'Establishing remote session…');

    // Notify the backend that a session is starting
    // Real implementation: backend signals the agent to prepare a
    // remote desktop / streaming session (Phase 5)
    await this.client.post(`/api/devices/${deviceId}/commands`, {
      type:    'CONNECT_REQUEST',
      payload: {},
    }).catch(() => {
      // CONNECT_REQUEST is not yet implemented — ignore the error
    });

    // ── Connected ────────────────────────────────────────────────────
    emit(ConnectionStep.CONNECTED, 'Connected');

    return {
      deviceId,
      step:       ConnectionStep.CONNECTED,
      message:    'Connected',
      startedAt,
    };
  }

  async disconnect(deviceId: string): Promise<void> {
    // Real implementation: close the streaming session
    // For now: send a no-op command to inform the agent
    await this.client.post(`/api/devices/${deviceId}/commands`, {
      type:    'STATUS_REQUEST',
      payload: {},
    }).catch(() => {});
  }
}
