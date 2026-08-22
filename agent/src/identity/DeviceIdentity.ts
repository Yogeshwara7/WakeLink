/**
 * Pairing status of this device — mirrors the mobile app's DeviceStatus
 * for the subset of states the agent itself tracks.
 */
export type PairingStatus = 'UNPAIRED' | 'PAIRING' | 'PAIRED';

/**
 * DeviceIdentity — the stable, persistent identity of this PC.
 *
 * IMPORTANT DESIGN DECISIONS:
 *
 * 1. `deviceId` is a random UUID generated once and never changed.
 *    It does NOT depend on IP address, hostname, MAC address, or username —
 *    any of which can change without notice.
 *
 * 2. `publicKey` is reserved for a future asymmetric key pair that the
 *    agent will use to prove its identity to the cloud without sending
 *    a shared secret. For the MVP it is null.
 *
 * 3. `pairingStatus` tracks whether this device has been associated with
 *    a user account. It starts UNPAIRED and transitions to PAIRED after
 *    the user completes the pairing flow on their phone.
 *
 * 4. This object is persisted via SecureStorage. When the agent restarts
 *    it loads the existing identity — a new deviceId is NEVER generated
 *    for an already-initialised device.
 */
export interface DeviceIdentity {
  /** Stable UUID — generated once, never regenerated. */
  deviceId: string;

  /** User-facing friendly name — defaults to OS hostname. */
  deviceName: string;

  /** Always 'windows' for the PC Agent. */
  platform: 'windows';

  /** Semver string of the running agent. */
  agentVersion: string;

  /**
   * Reserved: base64-encoded public key for future mutual TLS / challenge-response.
   * null until key generation is implemented.
   */
  publicKey: string | null;

  /** ISO-8601 timestamp when this identity was first created. */
  createdAt: string;

  /** ISO-8601 timestamp updated on every successful heartbeat. */
  lastSeenAt: string;

  /** Current pairing status. */
  pairingStatus: PairingStatus;

  /**
   * The userId from the WakeLink account this device is paired with.
   * null when UNPAIRED.
   */
  pairedUserId: string | null;
}
