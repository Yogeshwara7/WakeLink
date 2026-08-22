/**
 * StorageProvider — abstract interface for persistent key-value storage.
 *
 * Current implementation: FileStorageProvider (JSON file on disk).
 *
 * Future implementation: WindowsCredentialStorageProvider
 *   — stores sensitive values in the Windows Credential Manager via
 *     the `keytar` package or the Windows Data Protection API (DPAPI).
 *
 * Keeping this behind an interface means the swap is a one-liner in
 * the service registry, with no changes to any consuming module.
 */
export interface StorageProvider {
  /**
   * Read a value by key.
   * Returns null if the key does not exist.
   */
  read(key: string): Promise<string | null>;

  /**
   * Write a value. Creates the key if it doesn't exist.
   */
  write(key: string, value: string): Promise<void>;

  /**
   * Delete a key. No-op if the key does not exist.
   */
  delete(key: string): Promise<void>;

  /**
   * Returns true if the key exists.
   */
  has(key: string): Promise<boolean>;
}
