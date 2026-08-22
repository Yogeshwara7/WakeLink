import { Router } from 'express';
import type { Request, Response } from 'express';
import { DeviceStore, type StoredDevice } from '../store/DeviceStore';

const router = Router();
const store  = DeviceStore.getInstance();

/**
 * POST /api/devices/register
 *
 * Called by the PC Agent on startup to register (or re-register) itself.
 * If the device already exists, updates its metadata and marks it ONLINE.
 *
 * Body: DeviceRegistrationPayload (from ConnectionManager.ts)
 */
router.post('/register', (req: Request, res: Response) => {
  const {
    deviceId, deviceName, platform, agentVersion,
    os, osVersion, capabilities,
  } = req.body as Partial<StoredDevice>;

  if (!deviceId || !deviceName) {
    res.status(400).json({ error: 'deviceId and deviceName are required' });
    return;
  }

  const now = new Date().toISOString();
  const existing = store.devices.get(deviceId);

  const device: StoredDevice = {
    deviceId,
    deviceName:   deviceName,
    platform:     platform    ?? existing?.platform    ?? 'unknown',
    agentVersion: agentVersion ?? existing?.agentVersion ?? '0.0.0',
    os:           os          ?? existing?.os          ?? 'unknown',
    osVersion:    osVersion   ?? existing?.osVersion   ?? 'unknown',
    capabilities: capabilities ?? existing?.capabilities ?? {
      wakeOnLan: false,
      hardwareWake: false,
      remoteDesktop: false,
    },
    status:          'ONLINE',
    lastHeartbeatAt: now,
    registeredAt:    existing?.registeredAt ?? now,
    pairedUserId:    existing?.pairedUserId ?? null,
  };

  store.devices.set(deviceId, device);

  console.log(`[DEVICE] Registered: ${deviceId} (${deviceName})`);

  res.status(200).json({
    success: true,
    device: sanitise(device),
  });
});

/**
 * GET /api/devices/:deviceId
 *
 * Returns a device's current state.
 * Used by the mobile app to check if a PC is online before connecting.
 */
router.get('/:deviceId', (req: Request, res: Response) => {
  store.pruneStaleDevices();
  const device = store.devices.get(req.params['deviceId'] ?? '');
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  res.json({ device: sanitise(device) });
});

/**
 * GET /api/devices
 *
 * Returns all registered devices.
 * In production this would be scoped to the authenticated user.
 */
router.get('/', (_req: Request, res: Response) => {
  store.pruneStaleDevices();
  const devices = Array.from(store.devices.values()).map(sanitise);
  res.json({ devices });
});

/**
 * POST /api/devices/:deviceId/heartbeat
 *
 * Called by HeartbeatManager on every tick.
 * Updates lastHeartbeatAt and marks the device ONLINE.
 */
router.post('/:deviceId/heartbeat', (req: Request, res: Response) => {
  const deviceId = req.params['deviceId'] ?? '';
  const device   = store.devices.get(deviceId);

  if (!device) {
    // Device hasn't registered yet — accept the heartbeat, create a minimal record.
    const now = new Date().toISOString();
    const minimal: StoredDevice = {
      deviceId,
      deviceName:   req.body.deviceId ?? deviceId,
      platform:     'windows',
      agentVersion: req.body.agentVersion ?? '0.0.0',
      os:           req.body.os ?? 'unknown',
      osVersion:    req.body.osVersion ?? 'unknown',
      capabilities: { wakeOnLan: false, hardwareWake: false, remoteDesktop: false },
      status:          'ONLINE',
      lastHeartbeatAt: now,
      registeredAt:    now,
      pairedUserId:    null,
    };
    store.devices.set(deviceId, minimal);
    res.json({ success: true, acknowledged: true });
    return;
  }

  device.status          = 'ONLINE';
  device.lastHeartbeatAt = new Date().toISOString();

  // Update agent version if it changed (e.g. after an upgrade)
  if (req.body.agentVersion) {
    device.agentVersion = req.body.agentVersion as string;
  }

  res.json({ success: true, acknowledged: true });
});

/** Strip internal fields before sending to clients. */
function sanitise(device: StoredDevice): Record<string, unknown> {
  // Never expose pairedUserId to unauthenticated callers in real implementation.
  // For dev backend we include it for debugging convenience.
  return { ...device };
}

export default router;
