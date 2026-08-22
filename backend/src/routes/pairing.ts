import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DeviceStore, type StoredPairingSession } from '../store/DeviceStore';

const router = Router();
const store  = DeviceStore.getInstance();

/**
 * POST /api/pairing/start
 *
 * Mobile app calls this when the user taps "Add PC" and enters/scans a code.
 * The backend records the incoming code and waits for the agent to confirm it.
 *
 * In the real architecture, the agent generates the code and registers the
 * pairing session itself. For the dev backend, both paths are supported:
 *   - Agent pre-registered session: backend looks it up by pairingCode
 *   - No pre-registration: backend creates a pending session for the agent to pick up
 *
 * Body: { deviceId, pairingCode }
 */
router.post('/start', (req: Request, res: Response) => {
  const { deviceId, pairingCode } = req.body as {
    deviceId?: string;
    pairingCode?: string;
  };

  if (!pairingCode) {
    res.status(400).json({ error: 'pairingCode is required' });
    return;
  }

  const code = pairingCode.trim().toUpperCase();

  // Validate format: 6 alphanumeric characters
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    res.status(400).json({
      error: 'Invalid pairing code format. Must be 6 alphanumeric characters.',
    });
    return;
  }

  // Check if the device is registered and its session matches this code
  if (deviceId) {
    const device = store.devices.get(deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found. Make sure the PC Agent is running.' });
      return;
    }
  }

  // Look for an existing agent-generated pairing session with this code
  const existingSession = Array.from(store.pairing.values()).find(
    (s) => s.pairingCode === code && s.status === 'PENDING' && !s.consumed,
  );

  if (existingSession) {
    // Check expiry
    if (Date.now() > new Date(existingSession.expiresAt).getTime()) {
      existingSession.status = 'EXPIRED';
      res.status(410).json({ error: 'Pairing code has expired. Generate a new one on the PC Agent.' });
      return;
    }

    res.json({
      success: true,
      sessionId: existingSession.sessionId,
      deviceId:  existingSession.deviceId,
      message:   'Pairing session found. Confirm on the PC to complete pairing.',
    });
    return;
  }

  // No pre-registered session — create a pending one the agent will pick up
  const sessionId  = uuidv4();
  const now        = new Date();
  const expiresAt  = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  const session: StoredPairingSession = {
    sessionId,
    deviceId:    deviceId ?? '',
    pairingCode: code,
    createdAt:   now.toISOString(),
    expiresAt,
    consumed:    false,
    status:      'PENDING',
  };

  store.pairing.set(sessionId, session);

  console.log(`[PAIRING] Session started: ${sessionId} code=${code}`);

  res.json({
    success:   true,
    sessionId,
    expiresAt,
    message:   'Pairing code submitted. Waiting for PC Agent confirmation.',
  });
});

/**
 * POST /api/pairing/agent-register
 *
 * Called by the PC Agent when it generates a pairing session.
 * Stores the session so the mobile app can look it up by code.
 *
 * Body: AgentPairingSession (from PairingManager.ts)
 */
router.post('/agent-register', (req: Request, res: Response) => {
  const { sessionId, deviceId, pairingCode, expiresAt } = req.body as Partial<StoredPairingSession>;

  if (!sessionId || !deviceId || !pairingCode || !expiresAt) {
    res.status(400).json({ error: 'sessionId, deviceId, pairingCode, expiresAt are required' });
    return;
  }

  // Overwrite any previous session for this device
  const existing = Array.from(store.pairing.values()).find(
    (s) => s.deviceId === deviceId && s.status === 'PENDING',
  );
  if (existing) {
    store.pairing.delete(existing.sessionId);
  }

  const session: StoredPairingSession = {
    sessionId,
    deviceId,
    pairingCode: pairingCode.trim().toUpperCase(),
    createdAt:   new Date().toISOString(),
    expiresAt,
    consumed:    false,
    status:      'PENDING',
  };

  store.pairing.set(sessionId, session);
  console.log(`[PAIRING] Agent registered session: ${sessionId} device=${deviceId}`);

  res.json({ success: true });
});

/**
 * POST /api/pairing/complete
 *
 * Finalises a pairing. Called by the mobile app after the user assigns
 * a name and confirms. The backend sends a PAIR_CONFIRM command to the agent.
 *
 * Body: { sessionId, userId, deviceName }
 */
router.post('/complete', (req: Request, res: Response) => {
  const { sessionId, userId, deviceName } = req.body as {
    sessionId?: string;
    userId?: string;
    deviceName?: string;
  };

  if (!sessionId || !userId) {
    res.status(400).json({ error: 'sessionId and userId are required' });
    return;
  }

  const session = store.pairing.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Pairing session not found' });
    return;
  }
  if (session.status !== 'PENDING') {
    res.status(409).json({ error: `Pairing session is ${session.status}` });
    return;
  }
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.status = 'EXPIRED';
    res.status(410).json({ error: 'Pairing session has expired' });
    return;
  }

  // Mark confirmed
  session.status   = 'CONFIRMED';
  session.consumed = true;

  // Update device record
  const device = store.devices.get(session.deviceId);
  if (device) {
    device.pairedUserId = userId;
    if (deviceName) device.deviceName = deviceName;
  }

  // Queue a PAIR_CONFIRM command for the agent to pick up
  const commandId = uuidv4();
  const now       = new Date();
  store.commands.set(commandId, {
    commandId,
    deviceId:   session.deviceId,
    type:       'PAIR_CONFIRM',
    timestamp:  now.toISOString(),
    expiresAt:  new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
    payload:    { userId, pairingCode: session.pairingCode },
    result:     null,
    processedAt: null,
  });

  console.log(
    `[PAIRING] Completed: session=${sessionId} device=${session.deviceId}`,
  );

  res.json({
    success:  true,
    deviceId: session.deviceId,
    commandId,
    message:  'Pairing confirmed. PC Agent will receive PAIR_CONFIRM command.',
  });
});

/**
 * GET /api/pairing/status/:sessionId
 *
 * Mobile app polls this to know when the agent has confirmed pairing.
 */
router.get('/status/:sessionId', (req: Request, res: Response) => {
  const session = store.pairing.get(req.params['sessionId'] ?? '');
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    sessionId: session.sessionId,
    status:    session.status,
    deviceId:  session.deviceId,
    consumed:  session.consumed,
  });
});

export default router;
