import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DeviceStore, type StoredRelayCommand } from '../store/DeviceStore';
import { WakeOnLanService } from '../services/WakeOnLanService';

const router = Router();
const store  = DeviceStore.getInstance();
const wol    = new WakeOnLanService();

/**
 * POST /api/devices/:deviceId/wake
 *
 * Phase 4 wake flow:
 *
 *   1. Validate device exists, has MAC, has wakeSupported = true.
 *   2. If device is already ONLINE  → return immediately (skip wake).
 *   3. If device is already WAKING  → return 409 (duplicate request).
 *   4. If device has a relay registered AND relay is online
 *        → queue RELAY_WAKE command for the relay (internet-capable path)
 *   5. Else if no relay (same-LAN fallback)
 *        → send magic packet directly from the backend (Phase 3 behaviour)
 *   6. Set device WAKING, start timeout timer, return { wakeStatus: WAKING }.
 *
 * The relay polls GET /api/relay/:relayId/commands/pending,
 * executes the packet locally, and POSTs back the result.
 * The heartbeat remains the source of truth that the PC actually booted.
 *
 * Failure handling:
 *   - RELAY_NOT_CONFIGURED  → 422 (no relay, wake only possible on same LAN)
 *   - RELAY_OFFLINE         → 422 (relay registered but not reachable)
 *   - WAKE_NOT_SUPPORTED    → 422 (wakeSupported = false)
 *   - MAC_NOT_REGISTERED    → 422 (no MAC in device record)
 *   - ALREADY_ONLINE        → 200 with alreadyOnline: true
 *   - ALREADY_WAKING        → 409 (duplicate)
 */
router.post('/:deviceId/wake', async (req: Request, res: Response) => {
  const deviceId = req.params['deviceId'] ?? '';
  const device   = store.devices.get(deviceId);

  // ── 1. Device must exist ──────────────────────────────────────────────────
  if (!device) {
    res.status(404).json({
      error: 'Device not found',
      code:  'DEVICE_NOT_FOUND',
    });
    return;
  }

  // ── 2. Already ONLINE ─────────────────────────────────────────────────────
  if (device.status === 'ONLINE') {
    res.status(200).json({
      success:      true,
      deviceId,
      wakeStatus:   'ONLINE',
      alreadyOnline: true,
      message:      'PC is already online. Proceed to connect.',
    });
    return;
  }

  // ── 3. Already WAKING (duplicate) ─────────────────────────────────────────
  if (device.status === 'WAKING') {
    res.status(409).json({
      success:    false,
      deviceId,
      wakeStatus: 'WAKING',
      code:       'ALREADY_WAKING',
      message:    'A wake request is already in progress. Wait for the PC to come online.',
    });
    return;
  }

  // ── 4. Capability checks ──────────────────────────────────────────────────
  if (!device.macAddress) {
    res.status(422).json({
      error:  'MAC address not registered for this device.',
      code:   'MAC_NOT_REGISTERED',
      detail: 'The PC Agent must report its macAddress on registration before WoL is available.',
    });
    return;
  }

  if (!device.wakeSupported) {
    res.status(422).json({
      error:  'Wake-on-LAN is not supported by this device.',
      code:   'WAKE_NOT_SUPPORTED',
      detail: 'The device reported wakeSupported: false. Ensure BIOS and NIC settings are configured.',
    });
    return;
  }

  if (!WakeOnLanService.isValidMac(device.macAddress)) {
    res.status(422).json({
      error:  'Stored MAC address is invalid.',
      code:   'INVALID_MAC',
      detail: `MAC "${device.macAddress}" could not be parsed.`,
    });
    return;
  }

  const timeoutMs = parseInt(process.env['WOL_WAKE_TIMEOUT_MS'] ?? '120000', 10);
  const now       = new Date().toISOString();

  // ── 5. Route through relay if available ───────────────────────────────────
  const relay = store.getRelayForDevice(deviceId);

  if (relay) {
    // Relay is registered for this device
    if (!store.isRelayOnline(relay)) {
      res.status(422).json({
        error:  'Your home relay is offline.',
        code:   'RELAY_OFFLINE',
        detail: `Relay "${relay.relayName}" has not sent a heartbeat recently. ` +
                'Make sure the WakeLink Relay is running on your home device.',
      });
      return;
    }

    // Queue a RELAY_WAKE command for the relay to pick up
    const commandId = uuidv4();
    const relayCmd: StoredRelayCommand = {
      commandId,
      relayId:         relay.relayId,
      type:            'RELAY_WAKE',
      deviceId,
      macAddress:      device.macAddress,
      broadcastAddress: relay.broadcastAddress,
      timestamp:       now,
      expiresAt:       new Date(Date.now() + 2 * 60_000).toISOString(),
      processedAt:     null,
      result:          null,
    };
    store.relayCommands.set(commandId, relayCmd);

    device.status              = 'WAKING';
    device.wakeStatus          = 'WAKING';
    device.lastWakeRequestedAt = now;
    store.startWakeTimeout(deviceId, timeoutMs);

    console.log(
      `[WAKE] RELAY_WAKE queued for relay ${relay.relayId} ` +
      `(device ${deviceId}, mac ${device.macAddress})`,
    );

    res.status(200).json({
      success:             true,
      deviceId,
      wakeStatus:          'WAKING',
      lastWakeRequestedAt: now,
      via:                 'relay',
      relayId:             relay.relayId,
      message:             'Wake command sent to home relay. Waiting for PC to boot.',
    });
    return;
  }

  // ── 6. No relay — direct same-LAN fallback (Phase 3 behaviour) ───────────
  //
  // This path works when:
  //   - The backend is running on the same LAN as the sleeping PC (dev mode).
  //   - No relay has been set up yet.
  //
  // For remote (internet) wake, a relay MUST be configured.
  // We still attempt the direct send and note the limitation in the response.

  const isRemoteRequest = req.query['requireRelay'] === 'true';
  if (isRemoteRequest) {
    res.status(422).json({
      error:  'No relay configured for this device.',
      code:   'RELAY_NOT_CONFIGURED',
      detail: 'To wake your PC over the internet, install and configure the ' +
              'WakeLink Home Relay on an always-on device at home.',
    });
    return;
  }

  // Direct LAN send
  try {
    await wol.sendMagicPacket(device.macAddress);
  } catch (err) {
    console.error('[WAKE] Failed to send direct magic packet:', err);
    res.status(500).json({
      error:  'Failed to send wake packet.',
      code:   'PACKET_SEND_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  device.status              = 'WAKING';
  device.wakeStatus          = 'WAKING';
  device.lastWakeRequestedAt = now;
  store.startWakeTimeout(deviceId, timeoutMs);

  console.log(
    `[WAKE] Direct magic packet sent to ${device.macAddress} for device ${deviceId} ` +
    `(no relay, LAN-only, timeout: ${timeoutMs / 1000}s)`,
  );

  res.status(200).json({
    success:             true,
    deviceId,
    wakeStatus:          'WAKING',
    lastWakeRequestedAt: now,
    via:                 'direct',
    message:             'Wake packet sent directly (LAN only). ' +
                         'To wake over the internet, set up the WakeLink Home Relay.',
  });
});

export default router;
