import * as os from 'os';

/**
 * NetworkInterface — a single active network adapter.
 */
export interface NetworkInterface {
  name: string;
  address: string;     // IPv4 address
  mac: string;         // MAC address — used for WoL magic packet (future)
  internal: boolean;
}

/**
 * NetworkInfo — inspects the host's network adapters.
 *
 * Used by:
 *   - HeartbeatManager: report network connectivity
 *   - Future WoL implementation: enumerate MAC addresses
 *
 * SECURITY NOTE:
 *   MAC addresses are sent to the backend only over TLS and are used
 *   exclusively for Wake-on-LAN. They are never exposed in logs.
 */
export class NetworkInfo {
  /**
   * Returns all active (non-internal) IPv4 network interfaces.
   * Skips loopback (127.x.x.x) and link-local (169.254.x.x) addresses.
   */
  static getActiveInterfaces(): NetworkInterface[] {
    const raw = os.networkInterfaces();
    const result: NetworkInterface[] = [];

    for (const [name, addrs] of Object.entries(raw)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (
          addr.family === 'IPv4' &&
          !addr.internal &&
          !addr.address.startsWith('169.254.')
        ) {
          result.push({
            name,
            address: addr.address,
            mac:      addr.mac,
            internal: addr.internal,
          });
        }
      }
    }

    return result;
  }

  /** True if at least one active (non-internal) network interface exists. */
  static isNetworkAvailable(): boolean {
    return NetworkInfo.getActiveInterfaces().length > 0;
  }

  /**
   * Returns MAC addresses for all active interfaces.
   * Used by the future Wake-on-LAN implementation.
   * NEVER log the return value of this method.
   */
  static getMacAddresses(): string[] {
    return NetworkInfo.getActiveInterfaces().map((i) => i.mac);
  }
}
