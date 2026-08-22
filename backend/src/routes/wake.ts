import { Router } from 'express';
import type { Request, Response } from 'express';
import { DeviceStore } from '../store/DeviceStore';
import { WakeOnLanService } from '../services/WakeOnLanService';

const router  = Router();
const store   = DeviceStore.getInstance();
const wol     = new WakeOnLanService();

/**
 * POST /api/devices/:deviceId/wake
 *
 * Sends a Wake-on-LAN magic packet for the specified device.
 *
 * Preconditions (returns error if not met):
 *   1. Device must exist.
 *   2. Device must have a recorded macAddress.
 *   3. Device must have wakeSupported === true.
 *
 * On success:
 *   - Sets device.status        = 'WAKING'
 *   - Sets device.wakeStatus    = 'WAKING'
 *   - Records lastWakeRequestedAt
 *   - Starts a configurable timeout; if no heartbeat arrives within
 *     WOL_WAKE_TIMEOUT_MS (default 120 000 ms) the status rolls back to
 *     OFFLINE and wakeStatus becomes 'FAILED'.
 *   - Returns immediately — does NOT wait for the PC to boot.
 *
 * The heartbeat route (POST /api/devices/:id/heartbeat) is the
 * source of truth that the PC has booted: on arrival it cancels the
 * timeout and transitions WAKING → ONLINE.
 */
router.post('/:deviceId/wake', async (req: Request, res: Response) => {
  const deviceId = req.params['deviceId'] ?? '';
  const device   = store.devices.get(deviceId);

  // ── Validation ────────────────────────────────────────────────────────────
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  if (!device.macAddress) {
    res.status(422).json({
      error:  'MAC address not registered for this device.',
      detail: 'The PC Agent must report its macAddress on registration before WoL is available.',
    });
    return;
  }

  if (!device.wakeSupported) {
    res.status(422).json({
      error:  'Wake-on-LAN is not supported by this device.',
      detail: 'The device reported wakeSupported: false. Ensure BIOS and NIC settings are configured.',
    });
    return;
  }

  if (!WakeOnLanService.isValidMac(device.macAddress)) {
    res.status(422).json({
      error:  'Stored MAC address is invalid.',
      detail: `MAC "${device.macAddress}" could not be parsed.`,
    });
    return;
  }

  // ── Send magic packet ─────────────────────────────────────────────────────
  try {
    await wol.sendMagicPacket(device.macAddress);
  } catch (err) {
    console.error('[WAKE] Failed to send magic packet:', err);
    res.status(500).json({
      error:  'Failed to send wake packet.',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // ── Update state ──────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  device.status              = 'WAKING';
  device.wakeStatus          = 'WAKING';
  device.lastWakeRequestedAt = now;

  const timeoutMs = parseInt(process.env['WOL_WAKE_TIMEOUT_MS'] ?? '120000', 10);
  store.startWakeTimeout(deviceId, timeoutMs);

  console.log(
    `[WAKE] Magic packet sent to ${device.macAddress} for device ${deviceId} ` +
    `(timeout: ${timeoutMs / 1000}s)`,
  );

  res.status(200).json({
    success:   true,
    deviceId,
    wakeStatus: 'WAKING',
    lastWakeRequestedAt: now,
    message: 'Wake packet sent. Polling /api/devices/:id until status is ONLINE.',
  });
});

export default router;
