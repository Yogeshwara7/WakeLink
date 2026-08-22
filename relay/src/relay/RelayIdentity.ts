import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';

const IDENTITY_FILE = path.join(
  process.env['WAKELINK_STORAGE_DIR'] ?? path.join(os.homedir(), '.wakelink-relay'),
  'relay-identity.json',
);

export interface RelayIdentityData {
  relayId: string;
  relayToken: string;
  registeredAt: string;
}

/**
 * RelayIdentity — persists the relay's ID and token between restarts.
 *
 * The relayToken is sensitive. In production, move to OS keychain.
 * For the MVP, it lives in a local JSON file under ~/.wakelink-relay/.
 *
 * Environment variables take priority over the file so CI/Docker setups
 * can inject credentials without touching the filesystem.
 */
export class RelayIdentity {
  static load(): RelayIdentityData | null {
    // Env vars override file (useful for containers / CI)
    const envId    = process.env['WAKELINK_RELAY_ID'];
    const envToken = process.env['WAKELINK_RELAY_TOKEN'];
    if (envId && envToken) {
      return { relayId: envId, relayToken: envToken, registeredAt: '' };
    }

    if (!fs.existsSync(IDENTITY_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8')) as RelayIdentityData;
    } catch {
      return null;
    }
  }

  static save(data: RelayIdentityData): void {
    const dir = path.dirname(IDENTITY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  static clear(): void {
    if (fs.existsSync(IDENTITY_FILE)) fs.unlinkSync(IDENTITY_FILE);
  }
}
