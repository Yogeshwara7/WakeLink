import * as fs from 'fs';
import * as path from 'path';
import type { StorageProvider } from './StorageProvider';

/**
 * FileStorageProvider — stores key/value pairs as a JSON file on disk.
 *
 * Location: <storageDir>/wakelink-data.json
 *
 * This is the MVP storage implementation. It is intentionally simple
 * and suitable for non-secret data (device identity, pairing status).
 *
 * SECURITY NOTE:
 *   This file is stored in plain text. Do NOT store authentication tokens,
 *   private keys, or passwords here. Use WindowsCredentialStorageProvider
 *   (future) for sensitive values.
 *
 * UPGRADE PATH:
 *   Replace this with WindowsCredentialStorageProvider by swapping the
 *   implementation passed to SecureStorage in the agent bootstrap.
 */
export class FileStorageProvider implements StorageProvider {
  private readonly filePath: string;
  private data: Record<string, string> = {};
  private loaded = false;

  constructor(storageDir: string) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.filePath = path.join(storageDir, 'wakelink-data.json');
  }

  private load(): void {
    if (this.loaded) return;
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw) as Record<string, string>;
      } catch {
        // Corrupted file — start fresh rather than crash.
        this.data = {};
      }
    }
    this.loaded = true;
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  async read(key: string): Promise<string | null> {
    this.load();
    return this.data[key] ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.load();
    this.data[key] = value;
    this.save();
  }

  async delete(key: string): Promise<void> {
    this.load();
    delete this.data[key];
    this.save();
  }

  async has(key: string): Promise<boolean> {
    this.load();
    return key in this.data;
  }
}
