import * as dgram from 'dgram';

/**
 * WakeOnLanService — generates and sends a Wake-on-LAN magic packet via UDP.
 *
 * Magic packet format (RFC standard, 102 bytes total):
 *   6 bytes of 0xFF
 *   followed by the target MAC address repeated 16 times (96 bytes)
 *
 * The packet is broadcast to the network so it reaches the target machine
 * regardless of its IP address. Works on local networks and some routers
 * with directed broadcast support.
 *
 * Configuration (via environment variables):
 *   WOL_BROADCAST_ADDRESS  default: 255.255.255.255
 *   WOL_PORT               default: 9
 *
 * LIMITATIONS:
 *   - Requires Wake-on-LAN enabled in BIOS/UEFI.
 *   - Requires the network adapter to have WoL enabled in Windows Device Manager.
 *   - Does NOT work over the internet without a directed broadcast relay.
 *   - Laptops may require being plugged into power.
 *   - Only wakes the PC. Remote desktop streaming is NOT part of Phase 3.
 */
export class WakeOnLanService {
  private readonly broadcastAddress: string;
  private readonly port: number;

  constructor() {
    this.broadcastAddress =
      process.env['WOL_BROADCAST_ADDRESS'] ?? '255.255.255.255';
    this.port = parseInt(process.env['WOL_PORT'] ?? '9', 10);
  }

  /**
   * Validates and normalises a MAC address string.
   *
   * Accepts formats:
   *   AA:BB:CC:DD:EE:FF
   *   AA-BB-CC-DD-EE-FF
   *   AABBCCDDEEFF
   *
   * Returns the normalised uppercase hex string (no separators) or null if invalid.
   */
  static normaliseMac(mac: string): string | null {
    const cleaned = mac.replace(/[:\-]/g, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(cleaned)) return null;
    return cleaned;
  }

  /**
   * Returns true if the MAC address string is valid (any accepted format).
   */
  static isValidMac(mac: string): boolean {
    return WakeOnLanService.normaliseMac(mac) !== null;
  }

  /**
   * Builds the 102-byte WoL magic packet for the given MAC address.
   *
   * Structure:
   *   [FF FF FF FF FF FF] — 6 bytes sync
   *   [MAC × 16]         — 96 bytes
   *
   * @throws if the MAC address is invalid.
   */
  static buildMagicPacket(mac: string): Buffer {
    const normalised = WakeOnLanService.normaliseMac(mac);
    if (!normalised) {
      throw new Error(`Invalid MAC address: "${mac}"`);
    }

    // Parse MAC into 6 bytes
    const macBytes = Buffer.from(normalised, 'hex'); // 6 bytes

    // Build packet: 6×0xFF + MAC×16 = 6 + 96 = 102 bytes
    const packet = Buffer.alloc(102);

    // Sync header: 6 bytes of 0xFF
    packet.fill(0xff, 0, 6);

    // MAC repeated 16 times
    for (let i = 0; i < 16; i++) {
      macBytes.copy(packet, 6 + i * 6);
    }

    return packet;
  }

  /**
   * Sends the magic packet for the given MAC address.
   * Resolves when the UDP packet has been dispatched.
   * Rejects if the MAC is invalid or the UDP send fails.
   */
  sendMagicPacket(mac: string): Promise<void> {
    const packet = WakeOnLanService.buildMagicPacket(mac); // throws on bad MAC

    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');

      socket.once('error', (err) => {
        socket.close();
        reject(err);
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(
          packet,
          0,
          packet.length,
          this.port,
          this.broadcastAddress,
          (err) => {
            socket.close();
            if (err) reject(err);
            else resolve();
          },
        );
      });
    });
  }
}
