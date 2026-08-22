/**
 * WakeLink PC Agent — entry point
 *
 * Usage:
 *   npm run dev    (development, ts-node)
 *   npm start      (production, compiled JS)
 *
 * Expected startup output:
 *   [timestamp] [INFO ] WakeLink Agent starting...
 *   [timestamp] [INFO ] Agent version: 0.1.0
 *   [timestamp] [INFO ] Device ID:   <uuid>
 *   [timestamp] [INFO ] Device Name: <hostname>
 *   [timestamp] [INFO ] Pairing:     UNPAIRED
 *   [timestamp] [INFO ] ─────────────────────────────────────────
 *   [timestamp] [INFO ] PAIRING CODE: ABC123
 *   [timestamp] [INFO ] ─────────────────────────────────────────
 *   [timestamp] [INFO ] Agent state: INITIALISING → UNPAIRED
 *   [timestamp] [INFO ] Connected to development backend
 *   [timestamp] [INFO ] Heartbeat started (interval: 30s)
 *   [timestamp] [INFO ] Heartbeat sent
 */

import { Agent } from './agent/Agent';

const agent = new Agent();

agent.start().catch((err) => {
  // start() handles its own errors and calls process.exit(1),
  // but this catches any synchronous throw just in case.
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
