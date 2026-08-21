/**
 * Service registry — single place to swap mock ↔ real implementations.
 *
 * Import services from here in screens/hooks, never directly from mock files.
 * When building the real backend, replace the class imports below;
 * nothing in the UI changes.
 *
 * Circular-import note:
 *   MockConnectionService and MockPairingService need references to
 *   deviceService and wakeService.  We construct all instances first,
 *   then assign them to the registry so they share the same singletons.
 */
import { MockDeviceService } from './mock/MockDeviceService';
import { MockWakeService } from './mock/MockWakeService';
import { MockConnectionService } from './mock/MockConnectionService';
import { MockPairingService } from './mock/MockPairingService';
import { MockAuthService } from './mock/MockAuthService';

import type { DeviceService } from './DeviceService';
import type { WakeService } from './WakeService';
import type { ConnectionService } from './ConnectionService';
import type { PairingService } from './PairingService';
import type { AuthService } from './AuthService';

// Instantiate singletons
export const deviceService: DeviceService & InstanceType<typeof MockDeviceService> =
  new MockDeviceService();

export const wakeService: WakeService = new MockWakeService();

export const connectionService: ConnectionService = new MockConnectionService(
  deviceService,
  wakeService,
);

export const pairingService: PairingService = new MockPairingService(deviceService);

export const authService: AuthService = new MockAuthService();
