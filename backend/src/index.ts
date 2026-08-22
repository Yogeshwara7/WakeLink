/**
 * ⚠️  DEVELOPMENT ONLY — WakeLink Dev Backend
 *
 * This is a LOCAL development server that simulates the WakeLink Cloud API.
 * It is NOT production-ready:
 *   - No authentication
 *   - No TLS (use over localhost only)
 *   - In-memory store (data lost on restart)
 *   - No rate limiting
 *   - No user account management
 *
 * Purpose: let the PC Agent and mobile app communicate during Phase 2
 * development without needing real cloud infrastructure.
 *
 * Replace with the real WakeLink Cloud backend in Phase 3.
 */

import express from 'express';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import deviceRoutes  from './routes/devices';
import pairingRoutes from './routes/pairing';
import commandRoutes from './routes/commands';
import wakeRoutes    from './routes/wake';
import relayRoutes   from './routes/relay';
import { DeviceStore } from './store/DeviceStore';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const app  = express();
const store = DeviceStore.getInstance();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(requestLogger);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/devices',  deviceRoutes);
app.use('/api/pairing',  pairingRoutes);
app.use('/api/devices',  commandRoutes);
app.use('/api/devices',  wakeRoutes);
// Phase 4: Relay registry
app.use('/api/relay',    relayRoutes);

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  store.pruneStaleDevices();
  store.pruneStaleRelays();
  const devices = Array.from(store.devices.values());
  const relays  = Array.from(store.relays.values());
  res.json({
    status:          'ok',
    environment:     'development',
    timestamp:       new Date().toISOString(),
    devicesOnline:   devices.filter((d) => d.status === 'ONLINE').length,
    devicesTotal:    devices.length,
    relaysOnline:    relays.filter((r) => store.isRelayOnline(r)).length,
    relaysTotal:     relays.length,
    pairingSessions: store.pairing.size,
    pendingCommands: Array.from(store.commands.values()).filter(
      (c) => c.processedAt === null,
    ).length,
    pendingRelayCommands: Array.from(store.relayCommands.values()).filter(
      (c) => c.processedAt === null,
    ).length,
  });
});

// ── Debug: dump full state ───────────────────────────────────────────────────
app.get('/debug', (_req, res) => {
  res.json({
    warning:      'DEVELOPMENT ONLY — remove in production',
    devices:      Array.from(store.devices.values()),
    pairing:      Array.from(store.pairing.values()),
    commands:     Array.from(store.commands.values()),
    relays:       Array.from(store.relays.values()).map(({ relayTokenHash: _omit, ...r }) => r),
    relayCommands: Array.from(store.relayCommands.values()),
  });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start (only when run directly, not when imported by tests) ────────────────
if (require.main === module) {
  // Bind to 0.0.0.0 so the phone can reach the backend over Wi-Fi.
  // In production this is replaced by a real cloud backend with TLS.
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   WakeLink Dev Backend                 ║');
    console.log('║   ⚠️  DEVELOPMENT ONLY — not for prod  ║');
    console.log(`║   Listening on http://0.0.0.0:${PORT}    ║`);
    console.log(`║   Phone URL: http://192.168.1.3:${PORT}  ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log('║   POST /api/devices/register           ║');
    console.log('║   GET  /api/devices/:id                ║');
    console.log('║   POST /api/devices/:id/heartbeat      ║');
    console.log('║   POST /api/devices/:id/wake           ║');
    console.log('║   POST /api/pairing/start              ║');
    console.log('║   POST /api/pairing/complete           ║');
    console.log('║   POST /api/devices/:id/commands       ║');
    console.log('║   GET  /health                         ║');
    console.log('║   GET  /debug                          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
  });
}

export default app;
