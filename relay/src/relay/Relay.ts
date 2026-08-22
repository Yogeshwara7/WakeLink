import * as dotenv from 'dotenv';
import { loadConfig }      from '../config/Config';
import { HttpWakeRelay }   from '../network/HttpWakeRelay';
import { RelayIdentity }   from './RelayIdentity';
import { WolExecutor }     from './WolExecutor';
import type { RelayCommand } from '../interfaces/WakeRelay';

/**
 * Relay — top-level orchestrator for the WakeLink Home Relay.
 *
 * Startup sequence:
 *   1. Load config (env vars / .env file).
 *   2. Load or register relay identity (relayId + token).
 *   3. Start heartbeat loop.
 *   4. Start command poll loop.
 *
 * On each poll tick:
 *   - Fetch pending RELAY_WAKE commands from the backend.
 *   - For each command: send WoL magic packet, report result.
 *
 * All connections are OUTBOUND — no inbound ports required.
 */
export class Relay {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer:      NodeJS.Timeout | null = null;
  private relayId    = '';
  private relayToken = '';
  private stopping   = false;

  async start(): Promise<void> {
    dotenv.config();
    const config = loadConfig();

    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║   WakeLink Home Relay                 ║');
    console.log(`║   Backend: ${config.backendUrl.padEnd(27)}║`);
    console.log('╚═══════════════════════════════════════╝');
    console.log('');

    const transport = new HttpWakeRelay(config.backendUrl);

    // ── Step 1: Load or register identity ───────────────────────────────────
    let identity = RelayIdentity.load();

    if (!identity) {
      console.log('[RELAY] No identity found — registering with backend...');
      try {
        const result = await transport.register(config.relayName, []);
        identity = {
          relayId:      result.relayId,
          relayToken:   result.relayToken,
          registeredAt: new Date().toISOString(),
        };
        RelayIdentity.save(identity);
        console.log(`[RELAY] Registered. Relay ID: ${identity.relayId}`);
        console.log('[RELAY] Token saved to ~/.wakelink-relay/relay-identity.json');
      } catch (err) {
        console.error('[RELAY] Registration failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    } else {
      console.log(`[RELAY] Identity loaded. Relay ID: ${identity.relayId}`);
    }

    this.relayId    = identity.relayId;
    this.relayToken = identity.relayToken;

    // ── Step 2: Initial heartbeat ────────────────────────────────────────────
    await this.sendHeartbeat(transport).catch((e) =>
      console.warn('[RELAY] Initial heartbeat failed:', (e as Error).message),
    );

    // ── Step 3: Heartbeat loop ────────────────────────────────────────────────
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(transport).catch((e) =>
        console.warn('[RELAY] Heartbeat failed:', (e as Error).message),
      ),
      config.heartbeatIntervalMs,
    );
    console.log(`[RELAY] Heartbeat started (interval: ${config.heartbeatIntervalMs / 1000}s)`);

    // ── Step 4: Command poll loop ─────────────────────────────────────────────
    this.pollTimer = setInterval(
      () => this.pollCommands(transport, config.broadcastAddress, config.wolPort)
               .catch((e) => console.warn('[RELAY] Poll error:', (e as Error).message)),
      config.pollIntervalMs,
    );
    console.log(`[RELAY] Command polling started (interval: ${config.pollIntervalMs / 1000}s)`);

    // ── Graceful shutdown ─────────────────────────────────────────────────────
    const shutdown = () => {
      if (this.stopping) return;
      this.stopping = true;
      console.log('[RELAY] Shutting down...');
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.pollTimer)      clearInterval(this.pollTimer);
      console.log('[RELAY] Stopped.');
      process.exit(0);
    };
    process.on('SIGINT',  shutdown);
    process.on('SIGTERM', shutdown);

    console.log('[RELAY] Running. Press Ctrl+C to stop.');
  }

  private async sendHeartbeat(transport: HttpWakeRelay): Promise<void> {
    await transport.heartbeat(this.relayId, this.relayToken, []);
    console.log('[RELAY] Heartbeat sent');
  }

  private async pollCommands(
    transport: HttpWakeRelay,
    broadcastAddress: string,
    wolPort: number,
  ): Promise<void> {
    if (this.stopping) return;

    const commands = await transport.fetchPendingCommands(
      this.relayId,
      this.relayToken,
    );

    for (const cmd of commands) {
      await this.executeCommand(cmd, transport, broadcastAddress, wolPort);
    }
  }

  private async executeCommand(
    cmd: RelayCommand,
    transport: HttpWakeRelay,
    broadcastAddress: string,
    wolPort: number,
  ): Promise<void> {
    // Check expiry
    if (Date.now() > new Date(cmd.expiresAt).getTime()) {
      console.warn(`[RELAY] Command ${cmd.commandId} expired — skipping`);
      return;
    }

    console.log(
      `[RELAY] RELAY_WAKE received: device=${cmd.deviceId} mac=${cmd.macAddress}`,
    );

    // Use command's broadcastAddress if provided, else relay config default
    const broadcast = cmd.broadcastAddress || broadcastAddress;

    try {
      await WolExecutor.sendMagicPacket(cmd.macAddress, broadcast, wolPort);
      console.log(`[RELAY] Magic packet sent → ${cmd.macAddress} via ${broadcast}:${wolPort}`);

      await transport.reportResult(this.relayId, this.relayToken, {
        commandId: cmd.commandId,
        success:   true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[RELAY] Failed to send packet: ${message}`);
      await transport.reportResult(this.relayId, this.relayToken, {
        commandId: cmd.commandId,
        success:   false,
        error:     message,
      });
    }
  }
}
