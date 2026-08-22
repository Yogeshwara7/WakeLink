import * as http from 'http';
import * as https from 'https';
import type { IdentityManager } from '../identity/IdentityManager';
import type { AgentStateManager } from '../agent/AgentState';
import type { AgentConfig } from '../config/Config';
import type { CommandHandler } from '../commands/CommandHandler';
import type { AgentCommand } from '../commands/CommandHandler';
import { Logger } from '../utils/Logger';

/**
 * CommandPoller — periodically fetches and dispatches pending commands.
 *
 * Polls GET /api/devices/:deviceId/commands/pending on a short interval.
 * For each command, calls CommandHandler.handle() and POSTs the result back.
 *
 * This is the development polling implementation.
 * Production replacement: receive commands via persistent WebSocket push,
 * eliminating the need for polling entirely.
 *
 * Interval: 5 seconds (intentionally shorter than heartbeat so commands
 * are processed quickly during development).
 */
export class CommandPoller {
  private timer: NodeJS.Timeout | null = null;
  private readonly log = Logger.getInstance();
  private readonly POLL_INTERVAL_MS = 5_000;

  constructor(
    private readonly identityManager: IdentityManager,
    private readonly stateManager: AgentStateManager,
    private readonly commandHandler: CommandHandler,
    private readonly config: AgentConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.log.info('Command polling started (interval: 5s)');
    // Poll immediately, then on interval
    this.poll();
    this.timer = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info('Command polling stopped');
    }
  }

  private async poll(): Promise<void> {
    if (
      this.stateManager.is('STOPPING') ||
      this.stateManager.is('ERROR') ||
      this.stateManager.is('INITIALISING')
    ) return;

    const identity = this.identityManager.get();
    const url = `${this.config.backendUrl}/api/devices/${identity.deviceId}/commands/pending`;

    let commands: AgentCommand[];
    try {
      const body = await this.httpGet<{ commands: AgentCommand[] }>(url);
      commands = body.commands ?? [];
    } catch {
      // Network error — silently skip this tick (heartbeat already handles reconnect)
      return;
    }

    for (const cmd of commands) {
      const result = await this.commandHandler.handle(cmd);

      // Report result back to the backend
      const resultUrl =
        `${this.config.backendUrl}/api/devices/${identity.deviceId}/commands/${cmd.commandId}/result`;
      try {
        await this.httpPost(resultUrl, result);
      } catch (err) {
        this.log.warn(
          `Failed to report command result for ${cmd.commandId}: ` +
          (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  private httpGet<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed  = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'GET',
      };

      const req = (isHttps ? https : http).request(options, (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(raw) as T); }
            catch { resolve(raw as unknown as T); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(8_000, () => req.destroy(new Error('Timed out')));
      req.end();
    });
  }

  private httpPost(url: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const data    = JSON.stringify(body);
      const parsed  = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = (isHttps ? https : http).request(options, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.setTimeout(8_000, () => req.destroy(new Error('Timed out')));
      req.write(data);
      req.end();
    });
  }
}
