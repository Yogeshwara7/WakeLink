import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DeviceStore } from '../store/DeviceStore';

const router = Router();
const store  = DeviceStore.getInstance();

/**
 * POST /api/devices/:deviceId/commands
 *
 * Enqueue a command for the PC Agent.
 * Used by the mobile app (or dev testing tools) to send commands.
 *
 * In the real architecture:
 *   - Commands are pushed to the agent via its open WebSocket connection.
 *   - For dev, the agent polls this endpoint.
 *
 * Body: { type, payload? }
 * Supported: PING, STATUS_REQUEST
 * Defined-not-implemented: WAKE_REQUEST, CONNECT_REQUEST, SHUTDOWN_REQUEST, SLEEP_REQUEST
 */
router.post('/:deviceId/commands', (req: Request, res: Response) => {
  const deviceId = req.params['deviceId'] ?? '';
  const { type, payload = {} } = req.body as {
    type?: string;
    payload?: Record<string, unknown>;
  };

  if (!type) {
    res.status(400).json({ error: 'type is required' });
    return;
  }

  const device = store.devices.get(deviceId);
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const commandId = uuidv4();
  const now       = new Date();

  store.commands.set(commandId, {
    commandId,
    deviceId,
    type,
    timestamp:  now.toISOString(),
    expiresAt:  new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
    payload,
    result:     null,
    processedAt: null,
  });

  console.log(`[COMMAND] Queued: ${type} for device ${deviceId} (${commandId})`);

  res.status(201).json({ success: true, commandId });
});

/**
 * GET /api/devices/:deviceId/commands/pending
 *
 * PC Agent polls this to receive queued commands.
 * Returns all unprocessed commands for this device.
 *
 * In the real architecture this is replaced by WebSocket push.
 */
router.get('/:deviceId/commands/pending', (req: Request, res: Response) => {
  const deviceId = req.params['deviceId'] ?? '';
  const now      = Date.now();

  const pending = Array.from(store.commands.values()).filter(
    (c) =>
      c.deviceId === deviceId &&
      c.processedAt === null &&
      now < new Date(c.expiresAt).getTime(),
  );

  res.json({ commands: pending });
});

/**
 * POST /api/devices/:deviceId/commands/:commandId/result
 *
 * PC Agent reports the result of a command after processing it.
 *
 * Body: { success, data?, error? }
 */
router.post(
  '/:deviceId/commands/:commandId/result',
  (req: Request, res: Response) => {
    const commandId = req.params['commandId'] ?? '';
    const command   = store.commands.get(commandId);

    if (!command) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    if (command.deviceId !== (req.params['deviceId'] ?? '')) {
      res.status(403).json({ error: 'Command does not belong to this device' });
      return;
    }

    command.result      = req.body as Record<string, unknown>;
    command.processedAt = new Date().toISOString();

    console.log(
      `[COMMAND] Result received: ${command.type} (${commandId}) — ${
        (req.body as { success?: boolean }).success ? 'OK' : 'FAILED'
      }`,
    );

    res.json({ success: true });
  },
);

/**
 * GET /api/devices/:deviceId/commands/:commandId
 *
 * Check the result of a specific command.
 * Mobile app uses this to poll for STATUS_REQUEST results.
 */
router.get(
  '/:deviceId/commands/:commandId',
  (req: Request, res: Response) => {
    const command = store.commands.get(req.params['commandId'] ?? '');
    if (!command || command.deviceId !== (req.params['deviceId'] ?? '')) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    res.json({ command });
  },
);

export default router;
