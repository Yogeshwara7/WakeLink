import type { RemoteSessionProvider } from './RemoteSessionProvider';
import { MockSessionProvider } from './MockSessionProvider';
import { VncSessionProvider }  from './VncSessionProvider';
import { Logger } from '../utils/Logger';

/**
 * createSessionProvider — selects the concrete RemoteSessionProvider
 * based on WAKELINK_SESSION_PROVIDER environment variable.
 *
 * Values:
 *   mock  (default) — no-op, safe for dev without VNC installed
 *   vnc             — probes local VNC server (TightVNC / UltraVNC / RealVNC)
 *
 * Future values:
 *   webrtc          — WebRTC signalling + streaming
 *   rdp             — RDP over secure tunnel
 */
export function createSessionProvider(): RemoteSessionProvider {
  const log      = Logger.getInstance();
  const provider = (process.env['WAKELINK_SESSION_PROVIDER'] ?? 'mock').toLowerCase();

  switch (provider) {
    case 'vnc':
      log.info(`[Session] Using VncSessionProvider (${
        process.env['WAKELINK_VNC_HOST'] ?? 'localhost'
      }:${process.env['WAKELINK_VNC_PORT'] ?? '5900'})`);
      return new VncSessionProvider();

    case 'mock':
    default:
      log.info('[Session] Using MockSessionProvider (no real VNC — set WAKELINK_SESSION_PROVIDER=vnc to enable)');
      return new MockSessionProvider();
  }
}
