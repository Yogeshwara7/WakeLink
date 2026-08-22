/**
 * WakeLink Home Relay — entry point
 *
 * Usage:
 *   npm run dev    (development, ts-node)
 *   npm start      (production, compiled JS)
 *
 * First run: relay registers with the backend and saves its identity.
 * Subsequent runs: relay loads saved identity and reconnects.
 *
 * Expected output:
 *   ╔═══════════════════════════════════════╗
 *   ║   WakeLink Home Relay                 ║
 *   ║   Backend: http://localhost:3001      ║
 *   ╚═══════════════════════════════════════╝
 *   [RELAY] Registered. Relay ID: <uuid>
 *   [RELAY] Heartbeat started (interval: 60s)
 *   [RELAY] Command polling started (interval: 5s)
 *   [RELAY] Running. Press Ctrl+C to stop.
 *   [RELAY] Heartbeat sent
 *   [RELAY] RELAY_WAKE received: device=<id> mac=<mac>
 *   [RELAY] Magic packet sent → <mac> via 255.255.255.255:9
 */
import { Relay } from './relay/Relay';

const relay = new Relay();
relay.start().catch((err) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
