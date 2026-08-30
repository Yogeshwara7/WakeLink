import type { IdentityManager }        from '../identity/IdentityManager';
import type { PairingManager }         from '../pairing/PairingManager';
import type { AgentStateManager }      from '../agent/AgentState';
import type { RemoteSessionProvider }  from '../session/RemoteSessionProvider';
import { SystemInfo }                  from '../system/SystemInfo';
import { Logger }                      from '../utils/Logger';
import { httpPost }                    from '../utils/httpPost';

// ── Command type registry ───────────────────────────────────────────────────

/**
 * CommandType — all commands the agent can receive.
 *
 * IMPLEMENTED:
 *   PING               — echo pong
 *   STATUS_REQUEST     — return current device/agent state
 *   PAIR_CONFIRM       — backend confirms pairing completed
 *   CONNECT_REQUEST    — Phase 5: start a remote session
 *   DISCONNECT_REQUEST — Phase 5: end a remote session
 *
 * DEFINED, NOT YET IMPLEMENTED:
 *   WAKE_REQUEST      — future: wake from sleep via OS API
 *   SHUTDOWN_REQUEST  — future: graceful shutdown (requires explicit user opt-in)
 *   SLEEP_REQUEST     — future: put PC to sleep (requires explicit user opt-in)
 *
 * SECURITY: SHUTDOWN and SLEEP are deliberately not implemented.
 *   When added they must require explicit user confirmation in the mobile app
 *   and have rate limiting on the backend.
 */
export type CommandType =
  | 'STATUS_REQUEST'
  | 'PING'
  | 'PAIR_CONFIRM'
  | 'CONNECT_REQUEST'
  | 'DISCONNECT_REQUEST'
  | 'WAKE_REQUEST'       // NOT IMPLEMENTED
  | 'SHUTDOWN_REQUEST'   // NOT IMPLEMENTED
  | 'SLEEP_REQUEST';     // NOT IMPLEMENTED

export interface AgentCommand {
  commandId: string;
  deviceId: string;
  type: CommandType;
  timestamp: string;
  expiresAt?: string;
  payload: Record<string, unknown>;
}

export interface CommandResult {
  commandId: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_COMMAND_TTL_MS = 2 * 60 * 1000;

/**
 * CommandHandler — receives, validates, and executes agent commands.
 *
 * Security model:
 *   1. deviceId must match this agent's identity.
 *   2. Command must not be expired.
 *   3. commandId is idempotency-checked (replay protection).
 *   4. CONNECT_REQUEST additionally requires device to be PAIRED.
 *   5. Session tokens are never logged.
 */
export class CommandHandler {
  private readonly log         = Logger.getInstance();
  private readonly processedIds = new Set<string>();

  constructor(
    private readonly identityManager:   IdentityManager,
    private readonly pairingManager:    PairingManager,
    private readonly stateManager:      AgentStateManager,
    private readonly sessionProvider?:  RemoteSessionProvider,
    private readonly backendUrl?:       string,
  ) {}

  async handle(command: AgentCommand): Promise<CommandResult> {
    this.log.info(`Command received: ${command.type} (${command.commandId})`);

    const validation = this.validate(command);
    if (!validation.valid) {
      this.log.warn(`Command rejected: ${command.commandId} — ${validation.reason}`);
      return { commandId: command.commandId, success: false, error: validation.reason };
    }

    this.processedIds.add(command.commandId);

    try {
      const result = await this.dispatch(command);
      this.log.info(`Command completed: ${command.type} (${command.commandId})`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`Command failed: ${command.type}`, err instanceof Error ? err : undefined);
      return { commandId: command.commandId, success: false, error: message };
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validate(cmd: AgentCommand): { valid: boolean; reason?: string } {
    const identity = this.identityManager.get();

    if (cmd.deviceId !== identity.deviceId)
      return { valid: false, reason: 'Command deviceId does not match this device' };

    const expiresAt = cmd.expiresAt
      ? new Date(cmd.expiresAt).getTime()
      : new Date(cmd.timestamp).getTime() + DEFAULT_COMMAND_TTL_MS;

    if (Date.now() > expiresAt)
      return { valid: false, reason: 'Command has expired' };

    if (this.processedIds.has(cmd.commandId))
      return { valid: false, reason: 'Command already processed (duplicate)' };

    return { valid: true };
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  private async dispatch(command: AgentCommand): Promise<CommandResult> {
    switch (command.type) {
      case 'PING':               return this.handlePing(command);
      case 'STATUS_REQUEST':     return this.handleStatusRequest(command);
      case 'PAIR_CONFIRM':       return this.handlePairConfirm(command);
      case 'CONNECT_REQUEST':    return this.handleConnectRequest(command);
      case 'DISCONNECT_REQUEST': return this.handleDisconnectRequest(command);

      case 'WAKE_REQUEST':
      case 'SHUTDOWN_REQUEST':
      case 'SLEEP_REQUEST':
        this.log.warn(`Command type ${command.type} is not yet implemented`);
        return { commandId: command.commandId, success: false, error: `${command.type} is not yet implemented` };

      default: {
        const unknown = (command as AgentCommand).type;
        return { commandId: command.commandId, success: false, error: `Unknown command type: ${unknown}` };
      }
    }
  }

  // ── PING ──────────────────────────────────────────────────────────────────

  private handlePing(command: AgentCommand): CommandResult {
    return {
      commandId: command.commandId,
      success:   true,
      data:      { pong: true, timestamp: new Date().toISOString() },
    };
  }

  // ── STATUS_REQUEST ────────────────────────────────────────────────────────

  private handleStatusRequest(command: AgentCommand): CommandResult {
    const identity = this.identityManager.get();
    const system   = SystemInfo.capture();
    return {
      commandId: command.commandId,
      success:   true,
      data: {
        deviceId:       identity.deviceId,
        deviceName:     identity.deviceName,
        agentVersion:   identity.agentVersion,
        pairingStatus:  identity.pairingStatus,
        agentState:     this.stateManager.current,
        sessionProvider: this.sessionProvider?.constructor.name ?? 'none',
        os:             system.osVersion,
        uptimeSeconds:  system.uptimeSeconds,
        timestamp:      new Date().toISOString(),
      },
    };
  }

  // ── PAIR_CONFIRM ──────────────────────────────────────────────────────────

  private async handlePairConfirm(command: AgentCommand): Promise<CommandResult> {
    const userId = command.payload['userId'] as string | undefined;
    if (!userId)
      return { commandId: command.commandId, success: false, error: 'PAIR_CONFIRM missing userId in payload' };

    const pairingCode = command.payload['pairingCode'] as string | undefined;
    if (!pairingCode)
      return { commandId: command.commandId, success: false, error: 'PAIR_CONFIRM missing pairingCode in payload' };

    const identity = this.identityManager.get();
    const result   = await this.pairingManager.validatePairingRequest(pairingCode, identity.deviceId);

    if (!result.valid)
      return { commandId: command.commandId, success: false, error: result.reason };

    await this.pairingManager.completePairing(userId);
    return { commandId: command.commandId, success: true, data: { paired: true } };
  }

  // ── CONNECT_REQUEST ───────────────────────────────────────────────────────

  /**
   * CONNECT_REQUEST — Phase 5
   *
   * Flow:
   *   1. Validate device is PAIRED (not just ONLINE).
   *   2. Validate payload contains sessionId + sessionToken.
   *   3. Call RemoteSessionProvider.startSession().
   *   4. POST /api/sessions/:sessionId/agent-ready with connectionInfo.
   *   5. Return sessionInfo in CommandResult data.
   *
   * SECURITY:
   *   - Only PAIRED devices accept CONNECT_REQUEST.
   *   - sessionToken is passed through but never logged.
   *   - Session info is reported to backend over existing authenticated channel.
   */
  private async handleConnectRequest(command: AgentCommand): Promise<CommandResult> {
    const identity = this.identityManager.get();

    // Only paired devices should accept connection requests
    if (identity.pairingStatus !== 'PAIRED') {
      return {
        commandId: command.commandId,
        success:   false,
        error:     'Device is not paired. Complete pairing before connecting.',
      };
    }

    if (!this.sessionProvider) {
      return {
        commandId: command.commandId,
        success:   false,
        error:     'No session provider configured on this agent.',
      };
    }

    const sessionId    = command.payload['sessionId'] as string | undefined;
    const sessionToken = command.payload['sessionToken'] as string | undefined;

    if (!sessionId || !sessionToken) {
      return {
        commandId: command.commandId,
        success:   false,
        error:     'CONNECT_REQUEST missing sessionId or sessionToken in payload',
      };
    }

    this.log.info(`[Session] Starting session ${sessionId}`);

    let sessionInfo;
    try {
      sessionInfo = await this.sessionProvider.startSession({
        sessionId,
        sessionToken,
        backendUrl: this.backendUrl ?? 'http://localhost:3001',
        deviceId:   identity.deviceId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`[Session] Failed to start session ${sessionId}`, err instanceof Error ? err : undefined);

      // Notify backend of failure
      await this.reportSessionReady(sessionId, undefined, message);

      return { commandId: command.commandId, success: false, error: message };
    }

    // Report session ready to backend
    await this.reportSessionReady(sessionId, {
      wsProxyPath: sessionInfo.wsProxyPath,
      vncHost:     sessionInfo.vncHost,
      vncPort:     sessionInfo.vncPort,
      sessionType: sessionInfo.sessionType,
    });

    this.log.info(`[Session] Session ready: ${sessionId} (${sessionInfo.sessionType})`);

    return {
      commandId: command.commandId,
      success:   true,
      data: {
        sessionId:   sessionInfo.sessionId,
        wsProxyPath: sessionInfo.wsProxyPath,
        sessionType: sessionInfo.sessionType,
      },
    };
  }

  // ── DISCONNECT_REQUEST ────────────────────────────────────────────────────

  private async handleDisconnectRequest(command: AgentCommand): Promise<CommandResult> {
    const sessionId = command.payload['sessionId'] as string | undefined;
    if (!sessionId) {
      return {
        commandId: command.commandId,
        success:   false,
        error:     'DISCONNECT_REQUEST missing sessionId in payload',
      };
    }

    if (!this.sessionProvider) {
      return { commandId: command.commandId, success: true, data: { ended: true } };
    }

    if (this.sessionProvider.isSessionActive(sessionId)) {
      await this.sessionProvider.stopSession(sessionId);
      this.log.info(`[Session] Session stopped: ${sessionId}`);
    } else {
      this.log.info(`[Session] Session ${sessionId} not active — nothing to stop`);
    }

    // Notify backend the session has ended
    const backendUrl = this.backendUrl ?? 'http://localhost:3001';
    await httpPost(`${backendUrl}/api/sessions/${sessionId}/ended`, {})
      .catch((err) => this.log.warn(`[Session] Could not notify backend of session end: ${(err as Error).message}`));

    return { commandId: command.commandId, success: true, data: { ended: true, sessionId } };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async reportSessionReady(
    sessionId: string,
    connectionInfo?: { wsProxyPath: string; vncHost: string; vncPort: number; sessionType: string },
    error?: string,
  ): Promise<void> {
    const backendUrl = this.backendUrl ?? 'http://localhost:3001';
    const body = error ? { error } : { connectionInfo };
    try {
      await httpPost(`${backendUrl}/api/sessions/${sessionId}/agent-ready`, body);
    } catch (err) {
      this.log.warn(
        `[Session] Could not report session-ready to backend: ` +
        (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
