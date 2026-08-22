import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  DeviceStore,
  type StoredRelay,
  type StoredRelayCommand,
} from '../store/DeviceStore';
import { hashToken, verifyToken } from '../utils/hashToken';

const router = Router();
const store  = DeviceStore.getInstance();

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Extract and verify relay Bearer token from Authorization header.
 * Returns the relay record on success, null on failure.
 */
function authenticateRelay(req: Request, relayId: string): StoredRelay | null {
  const auth = req.headers['authorization'] ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const relay = store.relays.get(relayId);
  if (!relay) return null;
  if (!verifyToken(token, relay.relayTokenHash)) return null;
  return relay;
}

// ── POST /api/relay/register ──────────────────────────────────────────────────
/**
 * Called by the WakeLink Home Relay on first startup.
 * Generates a relayId and stores the hashed token.
 *
 * Body: { relayName, relayVersion, broadcastAddress?, deviceIds? }
 * Returns: { relayId, message }
 *
 * The raw relayToken is returned ONCE and must be saved by the relay.
 * It is never stored in plain text and cannot be retrieved again.
 */
router.post('/register', (req: Request, res: Response) => {
  const { relayName, relayVersion, broadcastAddress, deviceIds } =
    req.body as {
      relayName?: string;
      relayVersion?: string;
      broadcastAddress?: string;
      deviceIds?: string[];
    };

  if (!relayName) {
    res.status(400).json({ error: 'relayName is required' });
    return;
  }

  const relayId    = uuidv4();
  const rawToken   = uuidv4() + '-' + uuidv4(); // 73-char secret
  const now        = new Date().toISOString();

  const relay: StoredRelay = {
    relayId,
    relayTokenHash:  hashToken(rawToken),
    relayName:       relayName,
    relayVersion:    relayVersion ?? '0.1.0',
    status:          'ONLINE',
    lastHeartbeatAt: now,
    registeredAt:    now,
    deviceIds:       deviceIds ?? [],
    broadcastAddress: broadcastAddress ?? '255.255.255.255',
  };

  store.relays.set(relayId, relay);

  // Associate declared devices with this relay
  for (const deviceId of relay.deviceIds) {
    const device = store.devices.get(deviceId);
    if (device) device.relayId = relayId;
  }

  console.log(`[RELAY] Registered: ${relayId} (${relayName})`);

  // Raw token returned once — relay must persist it securely
  res.status(201).json({
    success:  true,
    relayId,
    relayToken: rawToken,   // ← only time this is visible
    message:
      'Relay registered. Save relayToken securely — it cannot be retrieved again.',
  });
});

// ── POST /api/relay/:relayId/heartbeat ────────────────────────────────────────
/**
 * Called by the relay every 60 seconds to report it is alive.
 * Authenticated with Bearer token.
 */
router.post('/:relayId/heartbeat', (req: Request, res: Response) => {
  const relay = authenticateRelay(req, req.params['relayId'] ?? '');
  if (!relay) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  relay.status          = 'ONLINE';
  relay.lastHeartbeatAt = new Date().toISOString();
  if (req.body.relayVersion) relay.relayVersion = req.body.relayVersion as string;

  // Update device associations if relay reports them
  const reportedDeviceIds: string[] = req.body.deviceIds ?? relay.deviceIds;
  relay.deviceIds = reportedDeviceIds;
  for (const deviceId of reportedDeviceIds) {
    const device = store.devices.get(deviceId);
    if (device) device.relayId = relay.relayId;
  }

  res.json({ success: true, acknowledged: true });
});

// ── GET /api/relay/:relayId/commands/pending ──────────────────────────────────
/**
 * The relay polls this endpoint to receive commands to execute.
 * Only returns non-expired, unprocessed RELAY_WAKE commands for this relay.
 * Authenticated with Bearer token.
 */
router.get('/:relayId/commands/pending', (req: Request, res: Response) => {
  const relay = authenticateRelay(req, req.params['relayId'] ?? '');
  if (!relay) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const now = Date.now();
  const pending = Array.from(store.relayCommands.values()).filter(
    (c) =>
      c.relayId === relay.relayId &&
      c.processedAt === null &&
      now < new Date(c.expiresAt).getTime(),
  );

  res.json({ commands: pending });
});

// ── POST /api/relay/:relayId/commands/:commandId/result ───────────────────────
/**
 * The relay reports the result of executing a RELAY_WAKE command.
 * Body: { success: boolean, error?: string }
 */
router.post(
  '/:relayId/commands/:commandId/result',
  (req: Request, res: Response) => {
    const relay = authenticateRelay(req, req.params['relayId'] ?? '');
    if (!relay) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cmd = store.relayCommands.get(req.params['commandId'] ?? '');
    if (!cmd || cmd.relayId !== relay.relayId) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }

    const body = req.body as { success?: boolean; error?: string };
    cmd.result      = { success: body.success ?? false, error: body.error };
    cmd.processedAt = new Date().toISOString();

    console.log(
      `[RELAY] Command result: RELAY_WAKE ${cmd.commandId} — ${
        body.success ? 'SUCCESS' : 'FAILED: ' + (body.error ?? '')
      }`,
    );

    // If relay reported failure, mark device wake as failed immediately
    if (!body.success) {
      const device = store.devices.get(cmd.deviceId);
      if (device && device.status === 'WAKING') {
        device.status     = 'OFFLINE';
        device.wakeStatus = 'FAILED';
        store.cancelWakeTimeout(cmd.deviceId);
        console.log(`[RELAY] Device ${cmd.deviceId} wake failed: ${body.error}`);
      }
    }

    res.json({ success: true });
  },
);

// ── GET /api/relay/:relayId ───────────────────────────────────────────────────
/**
 * Returns public relay status (no auth required — status is not sensitive).
 */
router.get('/:relayId', (req: Request, res: Response) => {
  store.pruneStaleRelays();
  const relay = store.relays.get(req.params['relayId'] ?? '');
  if (!relay) {
    res.status(404).json({ error: 'Relay not found' });
    return;
  }
  // Never expose the token hash
  const { relayTokenHash: _omit, ...safe } = relay;
  res.json({ relay: safe });
});

// ── POST /api/relay/:relayId/devices ─────────────────────────────────────────
/**
 * Associate additional devices with this relay.
 * Called by the relay when the PC Agent on the same network registers.
 * Body: { deviceIds: string[] }
 */
router.post('/:relayId/devices', (req: Request, res: Response) => {
  const relay = authenticateRelay(req, req.params['relayId'] ?? '');
  if (!relay) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const newIds: string[] = req.body.deviceIds ?? [];
  for (const deviceId of newIds) {
    if (!relay.deviceIds.includes(deviceId)) {
      relay.deviceIds.push(deviceId);
    }
    const device = store.devices.get(deviceId);
    if (device) device.relayId = relay.relayId;
  }

  res.json({ success: true, deviceIds: relay.deviceIds });
});

export default router;
