import * as dgram from 'dgram';

/**
 * WolExecutor — builds and sends WoL magic packets from the relay.
 *
 * Identical packet format to backend/src/services/WakeOnLanService.ts:
 *   6 bytes of 0xFF + MAC address repeated 16 times = 102 bytes total.
 *
 * Running WolExecutor on the home relay is what makes remote wake work:
 *   - The relay is on the same LAN as the sleeping PC.
 *   - The relay receives a RELAY_WAKE command via outbound HTTP.
 *   - The relay broadcasts the magic packet locally.
 *   - The sleeping PC's NIC receives it and powers the machine on.
 */
export class WolExecutor {
  static normaliseMac(mac: string): string | null {
    const c = mac.replace(/[:\-]/g, '').toUpperCase();
    return /^[0-9A-F]{12}$/.test(c) ? c : null;
  }

  static buildMagicPacket(mac: string): Buffer {
    const normalised = WolExecutor.normaliseMac(mac);
    if (!normalised) throw new Error(`Invalid MAC address: "${mac}"`);
    const macBytes = Buffer.from(normalised, 'hex');
    const packet   = Buffer.alloc(102);
    packet.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
    return packet;
  }

  static sendMagicPacket(
    mac: string,
    broadcastAddress = '255.255.255.255',
    port = 9,
  ): Promise<void> {
    const packet = WolExecutor.buildMagicPacket(mac);
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.once('error', (err) => { socket.close(); reject(err); });
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(packet, 0, packet.length, port, broadcastAddress, (err) => {
          socket.close();
          if (err) reject(err); else resolve();
        });
      });
    });
  }
}
