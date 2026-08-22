import type { StorageProvider } from './StorageProvider';

/**
 * SecureStorage — thin wrapper around StorageProvider.
 *
 * Consuming code always imports SecureStorage, never the provider directly.
 * This lets us swap the underlying provider (file → Windows Credential Manager)
 * without touching identity, pairing, or any other module.
 *
 * Usage:
 *   const storage = new SecureStorage(new FileStorageProvider(storageDir));
 *   await storage.set('deviceId', id);
 *   const id = await storage.get('deviceId');
 */
export class SecureStorage {
  constructor(private readonly provider: StorageProvider) {}

  async get(key: string): Promise<string | null> {
    return this.provider.read(key);
  }

  async set(key: string, value: string): Promise<void> {
    return this.provider.write(key, value);
  }

  async remove(key: string): Promise<void> {
    return this.provider.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.provider.has(key);
  }
}
