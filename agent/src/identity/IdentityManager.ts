import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { SecureStorage } from '../storage/SecureStorage';
import type { DeviceIdentity } from './DeviceIdentity';

const IDENTITY_KEY = 'device_identity';

/**
 * IdentityManager — owns the lifecycle of the device's persistent identity.
 *
 * Responsibilities:
 *   - Generate identity on first run.
 *   - Load existing identity on subsequent runs (NEVER regenerate deviceId).
 *   - Update mutable fields (lastSeenAt, pairingStatus, deviceName).
 *   - Persist changes via SecureStorage.
 *
 * The identity is stored as a JSON string under the key 'device_identity'.
 * To wipe and re-pair, delete the storage file or call reset().
 */
export class IdentityManager {
  private identity: DeviceIdentity | null = null;

  constructor(
    private readonly storage: SecureStorage,
    private readonly agentVersion: string,
  ) {}

  /**
   * Initialise — loads existing identity or creates a new one.
   * Must be called once before any other method.
   */
  async init(): Promise<DeviceIdentity> {
    const raw = await this.storage.get(IDENTITY_KEY);

    if (raw !== null) {
      // Existing identity — load it.
      this.identity = JSON.parse(raw) as DeviceIdentity;
      // Update agentVersion in case of upgrade.
      this.identity.agentVersion = this.agentVersion;
      return this.identity;
    }

    // First run — generate a new identity.
    const now = new Date().toISOString();
    this.identity = {
      deviceId: uuidv4(),
      deviceName: os.hostname(),
      platform: 'windows',
      agentVersion: this.agentVersion,
      publicKey: null,
      createdAt: now,
      lastSeenAt: now,
      pairingStatus: 'UNPAIRED',
      pairedUserId: null,
    };

    await this.persist();
    return this.identity;
  }

  /**
   * Returns the current identity.
   * Throws if init() has not been called.
   */
  get(): DeviceIdentity {
    if (!this.identity) {
      throw new Error('IdentityManager not initialised. Call init() first.');
    }
    return this.identity;
  }

  /** Update lastSeenAt to now and persist. */
  async touchLastSeen(): Promise<void> {
    this.assertInitialised();
    this.identity!.lastSeenAt = new Date().toISOString();
    await this.persist();
  }

  /** Mark device as paired with a user account. */
  async markPaired(userId: string): Promise<void> {
    this.assertInitialised();
    this.identity!.pairingStatus = 'PAIRED';
    this.identity!.pairedUserId = userId;
    this.identity!.lastSeenAt = new Date().toISOString();
    await this.persist();
  }

  /** Mark device as pairing in progress. */
  async markPairing(): Promise<void> {
    this.assertInitialised();
    this.identity!.pairingStatus = 'PAIRING';
    await this.persist();
  }

  /** Rename the device. */
  async rename(newName: string): Promise<void> {
    this.assertInitialised();
    this.identity!.deviceName = newName.trim();
    await this.persist();
  }

  /**
   * Reset identity — removes the stored identity so a new one is
   * generated on the next init(). Used for re-pairing.
   *
   * WARNING: This is destructive. The deviceId will change.
   */
  async reset(): Promise<void> {
    this.identity = null;
    await this.storage.remove(IDENTITY_KEY);
  }

  private assertInitialised(): void {
    if (!this.identity) {
      throw new Error('IdentityManager not initialised. Call init() first.');
    }
  }

  private async persist(): Promise<void> {
    await this.storage.set(IDENTITY_KEY, JSON.stringify(this.identity));
  }
}
