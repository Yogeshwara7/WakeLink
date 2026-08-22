/**
 * ApiPairingService — real implementation of PairingService.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Mock implementation (current):   src/services/mock/MockPairingService.ts
 * Real implementation (this file): src/services/api/ApiPairingService.ts
 *
 * Pairing flow:
 *   1. startPairing()   — creates a local PairingSession (no backend call yet)
 *   2. submitCode()     — POST /api/pairing/start  (validates code with backend)
 *   3. finalisePairing()— POST /api/pairing/complete (assigns name, triggers
 *                         PAIR_CONFIRM command to PC Agent)
 *   4. cancelPairing()  — no-op for now (backend GC handles expired sessions)
 *
 * TO ACTIVATE: In src/services/index.ts, replace:
 *   new MockPairingService(deviceService)
 * with:
 *   new ApiPairingService(apiClient, deviceService)
 * ─────────────────────────────────────────────────────────────────────
 */

import type { PairingService } from '../PairingService';
import type { PairingSession, PairingMethod } from '../../models/PairingSession';
import type { Device } from '../../models/Device';
import { DeviceStatus } from '../../models/Device';
import type { ApiClient } from './ApiClient';
import type { DeviceService } from '../DeviceService';

interface StartPairingResponse {
  success: boolean;
  sessionId: string;
  deviceId?: string;
  expiresAt?: string;
  message?: string;
  error?: string;
}

interface CompleteResponse {
  success: boolean;
  deviceId?: string;
  error?: string;
}

export class ApiPairingService implements PairingService {
  constructor(
    private readonly client: ApiClient,
    private readonly deviceService: DeviceService,
  ) {}

  async startPairing(method: PairingMethod): Promise<PairingSession> {
    // Return a local shell — the real network call happens in submitCode
    return {
      code:      '',
      method,
      status:    'pending',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async submitCode(
    session: PairingSession,
    code: string,
  ): Promise<PairingSession> {
    const normalised = code.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(normalised)) {
      return {
        ...session,
        code: normalised,
        status: 'failed',
        errorMessage:
          'Invalid code. Enter the 6-character code shown by the WakeLink Agent.',
      };
    }

    try {
      const res = await this.client.post<StartPairingResponse>(
        '/api/pairing/start',
        { pairingCode: normalised },
      );

      if (!res.success) {
        return {
          ...session,
          code: normalised,
          status: 'failed',
          errorMessage: res.error ?? 'Pairing failed.',
        };
      }

      return {
        ...session,
        code:      normalised,
        status:    'confirmed',
        expiresAt: res.expiresAt ?? session.expiresAt,
      };
    } catch (err) {
      return {
        ...session,
        code: normalised,
        status: 'failed',
        errorMessage:
          err instanceof Error ? err.message : 'Could not reach backend.',
      };
    }
  }

  async finalisePairing(
    session: PairingSession,
    deviceName: string,
  ): Promise<Device> {
    const res = await this.client.post<CompleteResponse>(
      '/api/pairing/complete',
      {
        sessionId:  session.code, // in real flow sessionId is returned by submitCode
        userId:     'pending-auth', // replaced when real auth is in place
        deviceName: deviceName.trim(),
      },
    );

    if (!res.success || !res.deviceId) {
      throw new Error(res.error ?? 'Pairing finalisation failed');
    }

    // Fetch the newly registered device from the backend
    const device = await this.deviceService.getDevice(res.deviceId);
    if (device) return device;

    // Fallback: construct a minimal Device record
    return {
      id:       res.deviceId,
      name:     deviceName.trim(),
      status:   DeviceStatus.OFFLINE,
      lastSeen: null,
      platform: 'windows',
      capabilities: {
        wakeOnLan:     true,
        hardwareWake:  false,
        remoteDesktop: false,
      },
    };
  }

  async cancelPairing(_session: PairingSession): Promise<void> {
    // Backend sessions expire automatically.
    // Real implementation: DELETE /api/pairing/:sessionId
  }
}
