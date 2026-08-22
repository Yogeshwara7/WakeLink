import type { IdentityManager } from '../identity/IdentityManager';
import type { PairingManager } from '../pairing/PairingManager';
import type { AgentStateManager } from '../agent/AgentState';
import { SystemInfo } from '../system/SystemInfo';
import { Logger } from '../utils/Logger';

// ── Command type registry ───────────────────────────────────────────────────

/**
 * CommandType — all commands the agent can receive.
 *
 * CURRENTLY IMPLEMENTED:
 *   STATUS_REQUEST — return current device status
 *   PING           — echo back a pong
 *   PAIR_CONFIRM   — backend confirms pairing completed
 *
 * DEFINED BUT NOT IMPLEMENTED (architecture placeholder):
 *   WAKE_REQUEST      — future: request to wake this PC from sleep
 *   CONNECT_REQUEST   — future: initiate a remote desktop session
 *   SHUTDOWN_REQUEST  — future: gracefully shut down the PC
 *   SLEEP_REQUEST     — future: put the PC to sleep
 *
 * SECURITY: Dangerous system-control commands (SHUTDOWN, SLEEP) are
 * deliberately not implemented yet. When implemented, they must:
 *   1. Be authenticated with the user's session token.
 *   2. Require explicit user confirmation in the mobile app.
 *   3. Have rate limiting on the backend.
 */
export type CommandType =
  | 'STATUS_REQUEST'
  | 'PING'
  | 'PAIR_CONFIRM'
  | 'WAKE_REQUEST'      // NOT IMPLEMENTED
  | 'CONNECT_REQUEST'   // NOT IMPLEMENTED
  | 'SHUTDOWN_REQUEST'  // NOT IMPLEMENTED
  | 'SLEEP_REQUEST';    // NOT IMPLEMENTED

/** Wire format of a command received from the backend. */
export interface AgentCommand {
  commandId: string;
  deviceId: string;
  type: CommandType;
  /** ISO-8601 timestamp when this command was issued. */
  timestamp: string;
  /** ISO-8601 timestamp after which this command is no longer valid. */
  expiresAt?: string;
  payload: Record<string, unknown>;
}

/** Result returned after processing a command. */
export interface CommandResult {
  commandId: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ── Command expiry ──────────────────────────────────────────────────────────

/** Commands expire after 2 minutes by default if no expiresAt is set. */
const DEFAULT_COMMAND_TTL_MS = 2 * 60 * 1000;

/**
 * CommandHandler — receives, validates, and executes agent commands.
 *
 * Security model:
 *   1. Command must be addressed to THIS device (deviceId check).
 *   2. Command must not be expired.
 *   3. Command must not have been processed before (idempotency via commandId).
 *   4. Unknown command types are rejected, not silently ignored.
 *
 * Future:
 *   Commands will arrive via the WebSocket connection and include an
 *   HMAC or JWT signature that must be verified before execution.
 */
export class CommandHandler {
  private readonly log = Logger.getInstance();
  /** Set of already-processed commandIds — prevents replay attacks. */
  private readonly processedIds = new Set<string>();

  constructor(
    private readonly identityManager: IdentityManager,
    private readonly pairingManager: PairingManager,
    private readonly stateManager: AgentStateManager,
  ) {}

  /**
   * Process a command.
   * Returns a CommandResult — never throws.
   */
  async handle(command: AgentCommand): Promise<CommandResult> {
    this.log.info(`Command received: ${command.type} (${command.commandId})`);

    // ── Validation ─────────────────────────────────────────────────────
    const validation = this.validate(command);
    if (!validation.valid) {
      this.log.warn(
        `Command rejected: ${command.commandId} — ${validation.reason}`,
      );
      return {
        commandId: command.commandId,
        success:   false,
        error:     validation.reason,
      };
    }

    // Mark as processed BEFORE execution for idempotency.
    this.processedIds.add(command.commandId);

    // ── Dispatch ────────────────────────────────────────────────────────
    try {
      const result = await this.dispatch(command);
      this.log.info(`Command completed: ${command.type} (${command.commandId})`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`Command failed: ${command.type}`, err instanceof Error ? err : undefined);
      return {
        commandId: command.commandId,
        success:   false,
        error:     message,
      };
    }
  }

  // ── Private: Validation ─────────────────────────────────────────────────

  private validate(
    command: AgentCommand,
  ): { valid: boolean; reason?: string } {
    const identity = this.identityManager.get();

    // 1. Device ID must match this device.
    if (command.deviceId !== identity.deviceId) {
      return { valid: false, reason: 'Command deviceId does not match this device' };
    }

    // 2. Must not be expired.
    const expiresAt = command.expiresAt
      ? new Date(command.expiresAt).getTime()
      : new Date(command.timestamp).getTime() + DEFAULT_COMMAND_TTL_MS;

    if (Date.now() > expiresAt) {
      return { valid: false, reason: 'Command has expired' };
    }

    // 3. Must not have been processed already (replay protection).
    if (this.processedIds.has(command.commandId)) {
      return { valid: false, reason: 'Command already processed (duplicate)' };
    }

    return { valid: true };
  }

  // ── Private: Dispatch ───────────────────────────────────────────────────

  private async dispatch(command: AgentCommand): Promise<CommandResult> {
    switch (command.type) {
      case 'PING':
        return this.handlePing(command);
      case 'STATUS_REQUEST':
        return this.handleStatusRequest(command);
      case 'PAIR_CONFIRM':
        return this.handlePairConfirm(command);

      // Not yet implemented — acknowledge but do nothing.
      case 'WAKE_REQUEST':
      case 'CONNECT_REQUEST':
      case 'SHUTDOWN_REQUEST':
      case 'SLEEP_REQUEST':
        this.log.warn(
          `Command type ${command.type} is not yet implemented`,
        );
        return {
          commandId: command.commandId,
          success:   false,
          error:     `${command.type} is not yet implemented`,
        };

      default: {
        const unknown = (command as AgentCommand).type;
        return {
          commandId: command.commandId,
          success:   false,
          error:     `Unknown command type: ${unknown}`,
        };
      }
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  private handlePing(command: AgentCommand): CommandResult {
    return {
      commandId: command.commandId,
      success: true,
      data: { pong: true, timestamp: new Date().toISOString() },
    };
  }

  private handleStatusRequest(command: AgentCommand): CommandResult {
    const identity = this.identityManager.get();
    const system   = SystemInfo.capture();
    return {
      commandId: command.commandId,
      success: true,
      data: {
        deviceId:     identity.deviceId,
        deviceName:   identity.deviceName,
        agentVersion: identity.agentVersion,
        pairingStatus: identity.pairingStatus,
        agentState:   this.stateManager.current,
        os:           system.osVersion,
        uptimeSeconds: system.uptimeSeconds,
        timestamp:    new Date().toISOString(),
      },
    };
  }

  private async handlePairConfirm(command: AgentCommand): Promise<CommandResult> {
    const userId = command.payload['userId'] as string | undefined;
    if (!userId) {
      return {
        commandId: command.commandId,
        success: false,
        error: 'PAIR_CONFIRM missing userId in payload',
      };
    }

    const pairingCode = command.payload['pairingCode'] as string | undefined;
    if (!pairingCode) {
      return {
        commandId: command.commandId,
        success: false,
        error: 'PAIR_CONFIRM missing pairingCode in payload',
      };
    }

    const identity = this.identityManager.get();
    const result = await this.pairingManager.validatePairingRequest(
      pairingCode,
      identity.deviceId,
    );

    if (!result.valid) {
      return {
        commandId: command.commandId,
        success: false,
        error: result.reason,
      };
    }

    await this.pairingManager.completePairing(userId);

    return {
      commandId: command.commandId,
      success: true,
      data: { paired: true },
    };
  }
}
