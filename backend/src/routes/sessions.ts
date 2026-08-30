import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DeviceStore, type StoredSession, type SessionConnectionInfo } from '../store/DeviceStore';

const router = Router();
const store  = DeviceStore.getInstance();

const SESSION_TTL_MS = parseInt(process.env['SESSION_TTL_MS'] ?? '3600000', 10); // 1 hour default

// ── POST /api/devices/:deviceId/connect ───────────────────────────────────
/**
 * Mobile app calls this when the user taps Connect and the PC is ONLINE.
 * Creates a session record in REQUESTED state and queues a CONNECT_REQUEST
 * command for the agent.
 *
 * The agent picks up the command, starts the VNC session, and POSTs
 * the result back with connection info. The mobile app polls
 * GET /api/sessions/:sessionId until status === 'READY'.
 */
router.post('/:deviceId/connect', (req: Request, res: Response) => {
  const deviceId = req.params['deviceId'] ?? '';
  const device   = store.devices.get(deviceId);

  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  if (device.status !== 'ONLINE') {
    res.status(409).json({
      error: 'Device is not online.',
      code:  'DEVICE_NOT_ONLINE',
      currentStatus: device.status,
    });
    return;
  }

  // Reject duplicate active sessions for the same device
  const existingActive = Array.from(store.sessions.values()).find(
    (s) =>
      s.deviceId === deviceId &&
      !['ENDED', 'FAILED', 'TIMEOUT'].includes(s.status),
  );
  if (existingActive) {
    res.status(409).json({
      error:     'A session is already active for this device.',
      code:      'SESSION_ALREADY_ACTIVE',
      sessionId: existingActive.sessionId,
      status:    existingActive.status,
    });
    return;
  }

  const now        = new Date();
  const sessionId  = uuidv4();
  const sessionToken = uuidv4(); // short-lived auth token — never log
  const userId     = (req.body as { userId?: string }).userId ?? 'pending-auth';

  const session: StoredSession = {
    sessionId,
    deviceId,
    userId,
    status:       'REQUESTED',
    createdAt:    now.toISOString(),
    expiresAt:    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    updatedAt:    now.toISOString(),
    sessionToken,
  };
  store.sessions.set(sessionId, session);

  // Queue CONNECT_REQUEST for the agent
  const commandId = uuidv4();
  store.commands.set(commandId, {
    commandId,
    deviceId,
    type:        'CONNECT_REQUEST',
    timestamp:   now.toISOString(),
    expiresAt:   new Date(now.getTime() + 2 * 60_000).toISOString(),
    payload:     { sessionId, sessionToken },
    result:      null,
    processedAt: null,
  });

  console.log(`[SESSION] Created: ${sessionId} for device ${deviceId}`);
  console.log(`[SESSION] CONNECT_REQUEST queued: ${commandId}`);

  res.status(201).json({
    success:   true,
    sessionId,
    sessionToken,
    status:    'REQUESTED',
    expiresAt: session.expiresAt,
    message:   'Session requested. Poll GET /api/sessions/:sessionId for status.',
  });
});

// ── GET /api/sessions/:sessionId ─────────────────────────────────────────
/**
 * Mobile app polls this after /connect to wait for READY status.
 * Returns session status and connectionInfo once the agent is ready.
 */
router.get('/:sessionId', (req: Request, res: Response) => {
  const session = store.sessions.get(req.params['sessionId'] ?? '');
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Auto-expire sessions past their TTL
  if (
    Date.now() > new Date(session.expiresAt).getTime() &&
    !['ENDED', 'FAILED', 'TIMEOUT'].includes(session.status)
  ) {
    session.status    = 'TIMEOUT';
    session.updatedAt = new Date().toISOString();
  }

  // Omit sessionToken from GET response (token was already sent at creation)
  const { sessionToken: _omit, ...safe } = session;
  res.json({ session: safe });
});

// ── POST /api/sessions/:sessionId/agent-ready ────────────────────────────
/**
 * Called by the agent (via command result) when the VNC session is ready.
 * Stores the connection info and transitions the session to READY.
 *
 * In practice this is called indirectly: the agent posts its CONNECT_REQUEST
 * result to /api/devices/:deviceId/commands/:commandId/result, and the
 * commands route calls this endpoint internally.
 *
 * For direct agent use, the agent can also POST here with connectionInfo.
 */
router.post('/:sessionId/agent-ready', (req: Request, res: Response) => {
  const session = store.sessions.get(req.params['sessionId'] ?? '');
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const body = req.body as { connectionInfo?: SessionConnectionInfo; error?: string };

  if (body.error) {
    session.status       = 'FAILED';
    session.errorMessage = body.error;
    session.updatedAt    = new Date().toISOString();
    console.log(`[SESSION] Failed: ${session.sessionId} — ${body.error}`);
    res.json({ success: true });
    return;
  }

  if (!body.connectionInfo) {
    res.status(400).json({ error: 'connectionInfo is required' });
    return;
  }

  session.status         = 'READY';
  session.connectionInfo = body.connectionInfo;
  session.updatedAt      = new Date().toISOString();
  console.log(`[SESSION] Ready: ${session.sessionId} (${body.connectionInfo.sessionType})`);
  res.json({ success: true });
});

// ── POST /api/sessions/:sessionId/disconnect ─────────────────────────────
/**
 * Mobile or agent calls this to end the session cleanly.
 * Also queues a DISCONNECT_REQUEST command for the agent.
 */
router.post('/:sessionId/disconnect', (req: Request, res: Response) => {
  const session = store.sessions.get(req.params['sessionId'] ?? '');
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (['ENDED', 'FAILED', 'TIMEOUT'].includes(session.status)) {
    res.json({ success: true, message: 'Session already ended.' });
    return;
  }

  session.status    = 'DISCONNECTING';
  session.updatedAt = new Date().toISOString();

  // Queue DISCONNECT_REQUEST for the agent
  const commandId = uuidv4();
  const now       = new Date();
  store.commands.set(commandId, {
    commandId,
    deviceId:    session.deviceId,
    type:        'DISCONNECT_REQUEST',
    timestamp:   now.toISOString(),
    expiresAt:   new Date(now.getTime() + 2 * 60_000).toISOString(),
    payload:     { sessionId: session.sessionId },
    result:      null,
    processedAt: null,
  });

  console.log(`[SESSION] Disconnect requested: ${session.sessionId}`);
  res.json({ success: true, status: 'DISCONNECTING' });
});

// ── POST /api/sessions/:sessionId/ended ──────────────────────────────────
/**
 * Agent calls this when the session has been fully torn down.
 */
router.post('/:sessionId/ended', (req: Request, res: Response) => {
  const session = store.sessions.get(req.params['sessionId'] ?? '');
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  session.status    = 'ENDED';
  session.updatedAt = new Date().toISOString();
  console.log(`[SESSION] Ended: ${session.sessionId}`);
  res.json({ success: true });
});

export default router;
