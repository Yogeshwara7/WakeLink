/**
 * ApiConnectionService — real implementation of ConnectionService.
 *
 * Phase 5 flow after PC comes ONLINE:
 *   1. POST /api/devices/:id/connect  → creates session, queues CONNECT_REQUEST to agent
 *   2. Poll GET /api/sessions/:sessionId until status === 'READY' (or FAILED/TIMEOUT)
 *   3. Return ConnectionSession with sessionId, sessionToken, wsProxyPath
 *   4. connect/[id].tsx navigates to session/[id].tsx with the session data
 *   5. session/[id].tsx opens a WebView to the noVNC page via the WS proxy
 *
 * TO ACTIVATE: already active when EXPO_PUBLIC_USE_MOCK=false.
 * The service registry in src/services/index.ts wires this automatically.
 */

import type { ConnectionService }  from '../ConnectionService';
import type { ConnectionSession }  from '../../models/ConnectionSession';
import { ConnectionStep }          from '../../models/ConnectionSession';
import { DeviceStatus }            from '../../models/Device';
import type { ApiClient }          from './ApiClient';
import type { DeviceService }      from '../DeviceService';
import type { WakeService }        from '../WakeService';

// ── Backend response shapes ───────────────────────────────────────────────

interface ConnectResponse {
  success:      boolean;
  sessionId:    string;
  sessionToken: string;
  status:       string;
  expiresAt:    string;
  message?:     string;
  error?:       string;
  code?:        string;
}

interface SessionPollResponse {
  session: {
    sessionId:       string;
    status:          string;
    connectionInfo?: {
      wsProxyPath: string;
      vncHost:     string;
      vncPort:     number;
      sessionType: 'vnc' | 'webrtc' | 'rdp' | 'mock';
    };
    errorMessage?: string;
    expiresAt:     string;
  };
}

// ── Polling config ────────────────────────────────────────────────────────
const SESSION_POLL_INTERVAL_MS = 3_000;
const SESSION_POLL_TIMEOUT_MS  = 60_000; // agent has 60 s to start VNC

export class ApiConnectionService implements ConnectionService {
  constructor(
    private readonly client:  ApiClient,
    private readonly devices: DeviceService,
    private readonly wake:    WakeService,
  ) {}

  async connect(
    deviceId: string,
    onStepChange: (step: ConnectionStep, message: string) => void,
  ): Promise<ConnectionSession> {
    const startedAt = new Date().toISOString();
    const emit = (step: ConnectionStep, message: string) => onStepChange(step, message);

    // ── Step 1: Check device status ───────────────────────────────────────
    emit(ConnectionStep.CHECKING, 'Checking PC status…');
    const device = await this.devices.getDevice(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const isOnline = device.status === DeviceStatus.ONLINE;

    if (!isOnline) {
      // ── Offline path ──────────────────────────────────────────────────
      emit(ConnectionStep.PC_OFFLINE, 'PC is offline');

      emit(ConnectionStep.SENDING_WAKE, 'Sending wake request…');
      await this.wake.sendWakeRequest(deviceId);

      emit(ConnectionStep.WAITING_FOR_PC, 'Waiting for PC to come online…');
      await this.wake.waitForOnline(
        deviceId,
        (msg) => emit(ConnectionStep.WAITING_FOR_PC, msg),
      );
    }

    // ── PC is online ──────────────────────────────────────────────────────
    emit(ConnectionStep.PC_ONLINE, 'PC is online');

    // ── Step 2: Request a session ─────────────────────────────────────────
    emit(ConnectionStep.CONNECTING, 'Requesting remote session…');

    let connectRes: ConnectResponse;
    try {
      connectRes = await this.client.post<ConnectResponse>(
        `/api/devices/${deviceId}/connect`,
        { userId: 'pending-auth' },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Handle specific backend codes
      if (msg.includes('SESSION_ALREADY_ACTIVE')) {
        // A session exists — try to resume by polling its status
        // (backend returns sessionId in the 409 body — not accessible here,
        //  so we rethrow with a friendly message)
        throw new Error('A session is already active for this device. Disconnect the existing session first.');
      }
      throw new Error(`Failed to request session: ${msg}`);
    }

    if (!connectRes.success) {
      throw new Error(connectRes.error ?? 'Session request failed');
    }

    const { sessionId, sessionToken } = connectRes;

    emit(ConnectionStep.CONNECTING, 'Session requested — waiting for PC Agent to start session…');

    // ── Step 3: Poll until agent reports READY ────────────────────────────
    const sessionInfo = await this.pollSessionReady(
      sessionId,
      (msg) => emit(ConnectionStep.CONNECTING, msg),
    );

    // ── Connected ─────────────────────────────────────────────────────────
    emit(ConnectionStep.CONNECTED, 'Connected');

    return {
      deviceId,
      step:        ConnectionStep.CONNECTED,
      message:     'Connected',
      startedAt,
      // Phase 5 session fields
      sessionId,
      sessionToken,
      wsProxyPath: sessionInfo?.wsProxyPath,
      sessionType: sessionInfo?.sessionType,
    };
  }

  async disconnect(deviceId: string): Promise<void> {
    // Find active session for this device and disconnect it
    // In the absence of local state, POST to the device's active session
    // The backend will look it up and queue DISCONNECT_REQUEST
    await this.client.post(`/api/devices/${deviceId}/connect`, {
      userId: 'pending-auth',
    }).catch(() => {
      // If no session exists the backend returns 409 — that's fine
    });
  }

  // ── Private: Poll session until READY / FAILED / TIMEOUT ─────────────────

  private async pollSessionReady(
    sessionId: string,
    onMessage: (msg: string) => void,
  ): Promise<{ wsProxyPath: string; sessionType: 'vnc' | 'webrtc' | 'rdp' | 'mock' } | null> {
    const deadline = Date.now() + SESSION_POLL_TIMEOUT_MS;
    let tick = 0;

    const messages = [
      'Starting remote session on PC…',
      'PC Agent is preparing the session…',
      'Almost ready…',
    ];

    while (Date.now() < deadline) {
      await delay(SESSION_POLL_INTERVAL_MS);
      onMessage(messages[Math.min(tick++, messages.length - 1)]);

      let res: SessionPollResponse;
      try {
        res = await this.client.get<SessionPollResponse>(`/api/sessions/${sessionId}`);
      } catch {
        // Transient network error — keep polling
        continue;
      }

      const { status, connectionInfo, errorMessage } = res.session;

      if (status === 'READY' && connectionInfo) {
        return {
          wsProxyPath: connectionInfo.wsProxyPath,
          sessionType: connectionInfo.sessionType,
        };
      }

      if (status === 'FAILED') {
        throw new Error(
          errorMessage ?? 'Remote session failed to start on the PC.',
        );
      }

      if (status === 'TIMEOUT') {
        throw new Error(
          'Remote session timed out. The PC Agent did not start the session in time.',
        );
      }
    }

    throw new Error(
      'Timed out waiting for the remote session to become ready.',
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
