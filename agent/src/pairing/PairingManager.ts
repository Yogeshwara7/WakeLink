import { v4 as uuidv4 } from 'uuid';
import type { IdentityManager } from '../identity/IdentityManager';
import type { SecureStorage } from '../storage/SecureStorage';
import type { AgentConfig } from '../config/Config';
import { Logger } from '../utils/Logger';

const PAIRING_SESSION_KEY = 'active_pairing_session';

/** Charset for the short human-readable pairing code (no ambiguous chars). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * QrPayload — the full payload encoded in the pairing QR code.
 * This is what the mobile app reads when it scans.
 */
export interface QrPayload {
  type: 'wakelink-pair';
  version: 1;
  deviceId: string;
  pairingCode: string;
  deviceName: string;
}

/**
 * PairingSession — one short-lived pairing attempt.
 *
 * SECURITY PROPERTIES:
 *   - pairingCode is short-lived (default: 5 minutes)
 *   - pairingCode is single-use (consumed flag)
 *   - pairingCode is NOT the permanent authentication credential
 *   - sessionId is a separate UUID for correlation
 */
export interface AgentPairingSession {
  sessionId: string;
  deviceId: string;
  pairingCode: string;
  qrPayload: QrPayload;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
}

/**
 * PairingManager — owns the one-time PC registration flow on the agent side.
 *
 * Responsibilities:
 *   - Generate a pairing session with a short-lived code.
 *   - Validate incoming pairing requests from the backend.
 *   - Mark the session as consumed after successful pairing.
 *   - Persist the active session so it survives an agent restart.
 *
 * Interface design mirrors the mobile PairingService so the two sides
 * speak the same language when the real backend is connected.
 */
export class PairingManager {
  private readonly log = Logger.getInstance();

  constructor(
    private readonly identityManager: IdentityManager,
    private readonly storage: SecureStorage,
    private readonly config: AgentConfig,
  ) {}

  /**
   * Generate (or reload) a pairing session.
   *
   * If a non-expired, unconsumed session already exists, returns it.
   * Otherwise generates a fresh one.
   */
  async generatePairingSession(): Promise<AgentPairingSession> {
    // Try to reload an existing unexpired session first.
    const existing = await this.loadSession();
    if (existing && !this.isExpired(existing) && !existing.consumed) {
      this.log.dbg('Reusing existing pairing session');
      return existing;
    }

    const identity = this.identityManager.get();
    const now = Date.now();
    const expiresAt = new Date(now + this.config.pairingExpiryMs).toISOString();
    const pairingCode = this.generateCode();

    const qrPayload: QrPayload = {
      type: 'wakelink-pair',
      version: 1,
      deviceId:    identity.deviceId,
      pairingCode,
      deviceName:  identity.deviceName,
    };

    const session: AgentPairingSession = {
      sessionId:   uuidv4(),
      deviceId:    identity.deviceId,
      pairingCode,
      qrPayload,
      createdAt:   new Date(now).toISOString(),
      expiresAt,
      consumed:    false,
    };

    await this.saveSession(session);
    await this.identityManager.markPairing();
    this.log.info(`Pairing session created (expires ${expiresAt})`);

    return session;
  }

  /**
   * Validate a pairing request arriving from the backend.
   *
   * Checks:
   *   1. Session exists and belongs to this device.
   *   2. Pairing code matches (case-insensitive).
   *   3. Session has not expired.
   *   4. Session has not already been consumed.
   *
   * Returns true + marks the session consumed on success.
   * Returns false with a reason string on failure.
   */
  async validatePairingRequest(
    incomingCode: string,
    deviceId: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const session = await this.loadSession();

    if (!session) {
      return { valid: false, reason: 'No active pairing session' };
    }
    if (session.deviceId !== deviceId) {
      return { valid: false, reason: 'Device ID mismatch' };
    }
    if (session.consumed) {
      return { valid: false, reason: 'Pairing code already used' };
    }
    if (this.isExpired(session)) {
      return { valid: false, reason: 'Pairing code has expired' };
    }
    if (session.pairingCode !== incomingCode.trim().toUpperCase()) {
      return { valid: false, reason: 'Invalid pairing code' };
    }

    // Mark consumed — single-use.
    session.consumed = true;
    await this.saveSession(session);

    return { valid: true };
  }

  /**
   * Complete pairing — mark identity as PAIRED with the given userId.
   * Called after the backend confirms the pairing.
   */
  async completePairing(userId: string): Promise<void> {
    await this.identityManager.markPaired(userId);
    await this.storage.remove(PAIRING_SESSION_KEY);
    this.log.info(`Pairing complete. Paired with user: [userId redacted from logs]`);
  }

  /** Cancel the active pairing session. */
  async cancelPairing(): Promise<void> {
    await this.storage.remove(PAIRING_SESSION_KEY);
    this.log.info('Pairing session cancelled');
  }

  /** Returns the current active session, or null. */
  async getActiveSession(): Promise<AgentPairingSession | null> {
    return this.loadSession();
  }

  /**
   * Inspect the persisted session and return a structured status.
   * Used by Agent.ts to decide what to do on startup when
   * pairingStatus is already 'PAIRING'.
   */
  async inspectSession(): Promise<{
    exists: boolean;
    expired: boolean;
    consumed: boolean;
    session: AgentPairingSession | null;
  }> {
    const session = await this.loadSession();
    if (!session) {
      return { exists: false, expired: false, consumed: false, session: null };
    }
    return {
      exists:   true,
      expired:  this.isExpired(session),
      consumed: session.consumed,
      session,
    };
  }

  /**
   * Clear a stale/expired pairing session and roll the identity back
   * to UNPAIRED so Agent.ts can generate a fresh session.
   *
   * IMPORTANT: this does NOT change the deviceId.
   * The identity file is updated in-place; only pairingStatus changes.
   */
  async resetExpiredSession(): Promise<void> {
    await this.storage.remove(PAIRING_SESSION_KEY);
    await this.identityManager.markUnpaired();
    this.log.info('Stale pairing session cleared — identity reset to UNPAIRED');
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private generateCode(): string {
    // 6 random characters from the safe charset.
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  private isExpired(session: AgentPairingSession): boolean {
    return Date.now() > new Date(session.expiresAt).getTime();
  }

  private async loadSession(): Promise<AgentPairingSession | null> {
    const raw = await this.storage.get(PAIRING_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AgentPairingSession;
  }

  private async saveSession(session: AgentPairingSession): Promise<void> {
    await this.storage.set(PAIRING_SESSION_KEY, JSON.stringify(session));
  }
}
