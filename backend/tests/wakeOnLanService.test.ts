import { WakeOnLanService } from '../src/services/WakeOnLanService';

describe('WakeOnLanService', () => {
  // ── MAC validation ─────────────────────────────────────────────────────────

  describe('isValidMac()', () => {
    it('accepts colon-separated uppercase MAC', () => {
      expect(WakeOnLanService.isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true);
    });

    it('accepts hyphen-separated MAC', () => {
      expect(WakeOnLanService.isValidMac('AA-BB-CC-DD-EE-FF')).toBe(true);
    });

    it('accepts plain 12-char hex string', () => {
      expect(WakeOnLanService.isValidMac('AABBCCDDEEFF')).toBe(true);
    });

    it('accepts lowercase MAC', () => {
      expect(WakeOnLanService.isValidMac('aa:bb:cc:dd:ee:ff')).toBe(true);
    });

    it('accepts mixed-case MAC', () => {
      expect(WakeOnLanService.isValidMac('aA:Bb:cC:Dd:eE:fF')).toBe(true);
    });

    it('rejects MAC with too few octets', () => {
      expect(WakeOnLanService.isValidMac('AA:BB:CC:DD:EE')).toBe(false);
    });

    it('rejects MAC with too many octets', () => {
      expect(WakeOnLanService.isValidMac('AA:BB:CC:DD:EE:FF:00')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(WakeOnLanService.isValidMac('')).toBe(false);
    });

    it('rejects invalid hex characters', () => {
      expect(WakeOnLanService.isValidMac('ZZ:BB:CC:DD:EE:FF')).toBe(false);
    });

    it('rejects partially formatted string', () => {
      expect(WakeOnLanService.isValidMac('AA:BB:CC')).toBe(false);
    });

    it('accepts real-world MAC address format', () => {
      expect(WakeOnLanService.isValidMac('00:1A:2B:3C:4D:5E')).toBe(true);
    });
  });

  describe('normaliseMac()', () => {
    it('returns uppercase 12-char hex string from colon format', () => {
      expect(WakeOnLanService.normaliseMac('aa:bb:cc:dd:ee:ff')).toBe('AABBCCDDEEFF');
    });

    it('strips hyphens', () => {
      expect(WakeOnLanService.normaliseMac('AA-BB-CC-DD-EE-FF')).toBe('AABBCCDDEEFF');
    });

    it('returns null for invalid MAC', () => {
      expect(WakeOnLanService.normaliseMac('not-a-mac')).toBeNull();
    });

    it('uppercases the result', () => {
      const result = WakeOnLanService.normaliseMac('aa:bb:cc:dd:ee:ff');
      expect(result).toBe(result?.toUpperCase());
    });
  });

  // ── Magic packet construction ───────────────────────────────────────────────

  describe('buildMagicPacket()', () => {
    const TEST_MAC = 'AA:BB:CC:DD:EE:FF';

    it('returns a Buffer of exactly 102 bytes', () => {
      const packet = WakeOnLanService.buildMagicPacket(TEST_MAC);
      expect(packet).toBeInstanceOf(Buffer);
      expect(packet.length).toBe(102);
    });

    it('starts with 6 bytes of 0xFF (sync header)', () => {
      const packet = WakeOnLanService.buildMagicPacket(TEST_MAC);
      for (let i = 0; i < 6; i++) {
        expect(packet[i]).toBe(0xff);
      }
    });

    it('contains the MAC address repeated exactly 16 times', () => {
      const packet = WakeOnLanService.buildMagicPacket(TEST_MAC);
      const macBytes = Buffer.from('AABBCCDDEEFF', 'hex'); // 6 bytes

      for (let i = 0; i < 16; i++) {
        const offset = 6 + i * 6;
        for (let b = 0; b < 6; b++) {
          expect(packet[offset + b]).toBe(macBytes[b]);
        }
      }
    });

    it('builds correct packet for hyphen-separated MAC', () => {
      const packetColon  = WakeOnLanService.buildMagicPacket('AA:BB:CC:DD:EE:FF');
      const packetHyphen = WakeOnLanService.buildMagicPacket('AA-BB-CC-DD-EE-FF');
      expect(packetColon.equals(packetHyphen)).toBe(true);
    });

    it('throws for an invalid MAC address', () => {
      expect(() => WakeOnLanService.buildMagicPacket('invalid')).toThrow(
        /Invalid MAC address/,
      );
    });

    it('total payload after header is 96 bytes (MAC × 16)', () => {
      const packet = WakeOnLanService.buildMagicPacket(TEST_MAC);
      expect(packet.length - 6).toBe(96);
    });
  });
});
