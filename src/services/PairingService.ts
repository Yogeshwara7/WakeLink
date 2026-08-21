import type { PairingSession, PairingMethod } from '../models/PairingSession';
import type { Device } from '../models/Device';

/**
 * PairingService — handles the one-time PC registration flow.
 *
 * The real implementation will:
 *   1. Have the PC Agent display a short-lived token/QR code.
 *   2. The mobile app submits the token here.
 *   3. The cloud verifies both sides and creates the device record.
 *
 * For the MVP, MockPairingService accepts any 6-digit code and
 * returns a fake paired device.
 */
export interface PairingService {
  /**
   * Initiates a pairing session for the given method.
   * Returns an initial PairingSession the UI can display.
   */
  startPairing(method: PairingMethod): Promise<PairingSession>;

  /**
   * Submits the pairing code (typed or scanned from QR).
   * Returns the confirmed PairingSession (status = 'confirmed') on success.
   */
  submitCode(
    session: PairingSession,
    code: string,
  ): Promise<PairingSession>;

  /**
   * Finalises pairing by assigning a friendly name.
   * Returns the newly created Device.
   */
  finalisePairing(
    session: PairingSession,
    deviceName: string,
  ): Promise<Device>;

  /** Cancels an in-progress pairing session. */
  cancelPairing(session: PairingSession): Promise<void>;
}
