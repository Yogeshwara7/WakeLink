/**
 * Represents an in-progress or completed pairing attempt.
 * The UI only sees this type — the concrete transport
 * (QR code scan, manual code, BLE, etc.) is hidden behind PairingService.
 */
export type PairingMethod = 'qr' | 'manual';

export type PairingStatus = 'idle' | 'pending' | 'confirmed' | 'failed';

export interface PairingSession {
  /** Opaque short-lived token displayed by the PC agent. */
  code: string;
  method: PairingMethod;
  status: PairingStatus;
  /** Friendly name the user assigns to the newly paired PC. */
  deviceName?: string;
  /** ISO-8601 timestamp when this session expires. */
  expiresAt: string;
  errorMessage?: string;
}
