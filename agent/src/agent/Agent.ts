import * as dotenv from 'dotenv';
import { loadConfig } from '../config/Config';
import { FileStorageProvider } from '../storage/FileStorageProvider';
import { SecureStorage } from '../storage/SecureStorage';
import { IdentityManager } from '../identity/IdentityManager';
import { PairingManager } from '../pairing/PairingManager';
import { ConnectionManager } from '../network/ConnectionManager';
import { HeartbeatManager } from '../network/HeartbeatManager';
import { CommandPoller } from '../network/CommandPoller';
import { CommandHandler } from '../commands/CommandHandler';
import { AgentStateManager } from './AgentState';
import { Logger } from '../utils/Logger';
import { httpPost } from '../utils/httpPost';

/**
 * Agent — the top-level orchestrator that wires all modules together.
 *
 * Startup sequence:
 *   1. Load config
 *   2. Initialise storage and identity
 *   3. Initialise pairing (generate session if UNPAIRED)
 *   4. Connect to backend
 *   5. Start heartbeat
 *   6. Start command listener
 *
 * Shutdown sequence (SIGINT / SIGTERM):
 *   1. Stop heartbeat
 *   2. Stop command listener
 *   3. Disconnect from backend
 */
export class Agent {
  private readonly stateManager = new AgentStateManager();
  private identityManager!: IdentityManager;
  private pairingManager!: PairingManager;
  private connectionManager!: ConnectionManager;
  private heartbeatManager!: HeartbeatManager;
  private commandHandler!: CommandHandler;
  private commandPoller!: CommandPoller;

  async start(): Promise<void> {
    dotenv.config();
    const config = loadConfig();
    const log = Logger.getInstance();

    log.info('WakeLink Agent starting...');
    log.info(`Agent version: ${config.agentVersion}`);
    log.info(`Backend: ${config.backendUrl}`);
    log.info(`Storage: ${config.storageDir}`);

    // ── Log state transitions ──────────────────────────────────────────────
    this.stateManager.onChange((prev, next) => {
      log.info(`Agent state: ${prev} → ${next}`);
    });

    try {
      // ── Step 1: Storage + Identity ─────────────────────────────────────
      const storage = new SecureStorage(
        new FileStorageProvider(config.storageDir),
      );
      this.identityManager = new IdentityManager(storage, config.agentVersion);
      const identity = await this.identityManager.init();

      log.info(`Device ID:   ${identity.deviceId}`);
      log.info(`Device Name: ${identity.deviceName}`);
      log.info(`Pairing:     ${identity.pairingStatus}`);

      // ── Step 2: Pairing Manager ────────────────────────────────────────
      this.pairingManager = new PairingManager(
        this.identityManager,
        storage,
        config,
      );

      if (identity.pairingStatus === 'UNPAIRED') {
        this.stateManager.transition('UNPAIRED');
        const session = await this.pairingManager.generatePairingSession();
        log.info('─────────────────────────────────────────');
        log.info('PAIRING CODE: ' + session.pairingCode);
        log.info('QR PAYLOAD:   ' + JSON.stringify(session.qrPayload));
        log.info(`Expires:      ${session.expiresAt}`);
        log.info('─────────────────────────────────────────');
        log.info('Open WakeLink on your phone and pair this device.');
        this.stateManager.transition('PAIRING');

        // Register pairing session with the dev backend so the mobile app
        // can look it up when the user enters the code.
        try {
          await httpPost(
            `${config.backendUrl}/api/pairing/agent-register`,
            session,
          );
          log.info('Pairing session registered with backend');
        } catch (err) {
          log.warn(
            'Could not register pairing session with backend: ' +
            (err instanceof Error ? err.message : String(err)),
          );
        }
      }

      // ── Step 3: Connection Manager ─────────────────────────────────────
      this.connectionManager = new ConnectionManager(
        this.identityManager,
        this.stateManager,
        config,
      );

      this.commandHandler = new CommandHandler(
        this.identityManager,
        this.pairingManager,
        this.stateManager,
      );

      this.commandPoller = new CommandPoller(
        this.identityManager,
        this.stateManager,
        this.commandHandler,
        config,
      );

      // ── Step 4: Heartbeat ──────────────────────────────────────────────
      this.heartbeatManager = new HeartbeatManager(
        this.identityManager,
        this.stateManager,
        config,
      );

      // ── Step 5: Connect + start heartbeat ─────────────────────────────
      await this.connectionManager.connect();
      this.heartbeatManager.start();
      this.commandPoller.start();

      log.info('WakeLink Agent is running. Press Ctrl+C to stop.');

      // ── Graceful shutdown ──────────────────────────────────────────────
      const shutdown = async () => {
        log.info('Shutting down...');
        this.stateManager.forceTransition('STOPPING');
        this.heartbeatManager.stop();
        this.commandPoller.stop();
        await this.connectionManager.disconnect();
        log.info('Agent stopped.');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (err) {
      this.stateManager.forceTransition('ERROR');
      Logger.getInstance().error(
        'Fatal error during agent startup',
        err instanceof Error ? err : new Error(String(err)),
      );
      process.exit(1);
    }
  }
}
