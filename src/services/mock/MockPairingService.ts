import type { PairingService } from '../PairingService';
import type { PairingSession, PairingMethod } from '../../models/PairingSession';
import type { Device } from '../../models/Device';
import { DeviceStatus } from '../../models/Device';
import type { MockDeviceService } from './MockDeviceService';

/**
 * MockPairingService — accepts any 6-character alphanumeric code.
 *
 * Replace with a real implementation that:
 *   1. Validates the token against the WakeLink Cloud (the PC Agent generates it).
 *   2. The cloud binds the device identity to the user account on success.
 *   3. Returns the permanent Device record from the cloud.
 */
export class MockPairingService implements PairingService {
  constructor(private readonly devices: MockDeviceService) {}

  async startPairing(method: PairingMethod): Promise<PairingSession> {
    await delay(200);
    return {
      code: '',
      method,
      status: 'pending',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }

  async submitCode(session: PairingSession, code: string): Promise<PairingSession> {
    await delay(800);

    const normalised = code.trim().toUpperCase();

    // Mock validation: any 6-character alphanumeric code is accepted.
    if (!/^[A-Z0-9]{6}$/.test(normalised)) {
      return {
        ...session,
        code: normalised,
        status: 'failed',
        errorMessage:
          'Invalid code. Please enter the 6-character code shown on your PC.',
      };
    }

    return { ...session, code: normalised, status: 'confirmed' };
  }

  async finalisePairing(session: PairingSession, deviceName: string): Promise<Device> {
    await delay(500);

    const newDevice: Device = {
      id: `device-${Date.now()}`,
      name: deviceName.trim() || 'My PC',
      status: DeviceStatus.OFFLINE,
      lastSeen: null,
      platform: 'windows',
      capabilities: {
        wakeOnLan: true,
        hardwareWake: false,
        remoteDesktop: true,
      },
    };

    this.devices._addDevice(newDevice);
    return { ...newDevice };
  }

  async cancelPairing(_session: PairingSession): Promise<void> {
    await delay(100);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
