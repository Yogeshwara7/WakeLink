/**
 * API service factory — creates real service implementations backed
 * by the WakeLink backend.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW TO SWITCH FROM MOCK TO REAL:
 *
 * In src/services/index.ts, replace the mock imports with:
 *
 *   import { createApiServices } from './api';
 *
 *   const { deviceService, wakeService, connectionService, pairingService }
 *     = createApiServices({
 *         baseUrl:  'https://api.wakelink.app',   // or http://localhost:3001
 *         getToken: () => authService.getSession()
 *                           .then(s => s?.accessToken ?? null),
 *       });
 *
 *   export { deviceService, wakeService, connectionService, pairingService };
 *
 * Everything else — screens, hooks, state — stays identical.
 * ─────────────────────────────────────────────────────────────────────
 */

import { ApiClient } from './ApiClient';
import { ApiDeviceService }     from './ApiDeviceService';
import { ApiWakeService }       from './ApiWakeService';
import { ApiConnectionService } from './ApiConnectionService';
import { ApiPairingService }    from './ApiPairingService';

import type { DeviceService }     from '../DeviceService';
import type { WakeService }       from '../WakeService';
import type { ConnectionService } from '../ConnectionService';
import type { PairingService }    from '../PairingService';

export interface ApiServicesConfig {
  baseUrl:   string;
  getToken?: () => Promise<string | null>;
}

export interface ApiServices {
  client:            ApiClient;
  deviceService:     DeviceService;
  wakeService:       WakeService;
  connectionService: ConnectionService;
  pairingService:    PairingService;
}

export function createApiServices(config: ApiServicesConfig): ApiServices {
  const client            = new ApiClient(config);
  const deviceService     = new ApiDeviceService(client);
  const wakeService       = new ApiWakeService(client);
  const connectionService = new ApiConnectionService(client, deviceService, wakeService);
  const pairingService    = new ApiPairingService(client, deviceService);

  return { client, deviceService, wakeService, connectionService, pairingService };
}

export { ApiClient }          from './ApiClient';
export { ApiDeviceService }   from './ApiDeviceService';
export { ApiWakeService }     from './ApiWakeService';
export { ApiConnectionService } from './ApiConnectionService';
export { ApiPairingService }  from './ApiPairingService';
