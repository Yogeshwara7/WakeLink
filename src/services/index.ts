/**
 * Service registry — single place to swap mock ↔ real implementations.
 *
 * CURRENT MODE: Hybrid
 *   - DeviceService, WakeService, ConnectionService, PairingService
 *     → real API implementations backed by the dev backend
 *   - AuthService → still mocked (real auth is Phase 5)
 *
 * The backend URL is read from EXPO_PUBLIC_BACKEND_URL.
 * Set it in a .env file at the repo root:
 *
 *   EXPO_PUBLIC_BACKEND_URL=http://192.168.1.3:3001
 *
 * Falls back to localhost (Android emulator) if not set.
 *
 * TO USE MOCK SERVICES: set EXPO_PUBLIC_USE_MOCK=true in .env
 */

import { createApiServices }     from './api';
import { MockDeviceService }     from './mock/MockDeviceService';
import { MockWakeService }       from './mock/MockWakeService';
import { MockConnectionService } from './mock/MockConnectionService';
import { MockPairingService }    from './mock/MockPairingService';
import { MockAuthService }       from './mock/MockAuthService';

import type { DeviceService }     from './DeviceService';
import type { WakeService }       from './WakeService';
import type { ConnectionService } from './ConnectionService';
import type { PairingService }    from './PairingService';
import type { AuthService }       from './AuthService';

// Auth is always mocked until Phase 5
export const authService: AuthService = new MockAuthService();

// ── Service selection ─────────────────────────────────────────────────────────
const useMock    = process.env['EXPO_PUBLIC_USE_MOCK'] === 'true';
const backendUrl = process.env['EXPO_PUBLIC_BACKEND_URL'] ?? 'http://localhost:3001';

function buildServices(): {
  deviceService:     DeviceService;
  wakeService:       WakeService;
  connectionService: ConnectionService;
  pairingService:    PairingService;
} {
  if (useMock) {
    // Full mock — no network calls, works without a running backend
    const mockDevice  = new MockDeviceService();
    const mockWake    = new MockWakeService();
    return {
      deviceService:     mockDevice,
      wakeService:       mockWake,
      connectionService: new MockConnectionService(mockDevice, mockWake),
      pairingService:    new MockPairingService(mockDevice),
    };
  }

  // Real API services — backed by the dev backend (or real cloud)
  const api = createApiServices({
    baseUrl:  backendUrl,
    getToken: () => authService.getSession().then((s) => s?.accessToken ?? null),
  });

  return {
    deviceService:     api.deviceService,
    wakeService:       api.wakeService,
    connectionService: api.connectionService,
    pairingService:    api.pairingService,
  };
}

const services = buildServices();

export const deviceService:     DeviceService     = services.deviceService;
export const wakeService:       WakeService       = services.wakeService;
export const connectionService: ConnectionService = services.connectionService;
export const pairingService:    PairingService    = services.pairingService;
