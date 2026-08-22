/**
 * Logger — minimal structured logger for the agent.
 *
 * Outputs timestamped lines to stdout/stderr.
 * Does NOT log secrets, tokens, or private keys.
 *
 * Future: replace with a proper logger (pino, winston) if log shipping
 * to a monitoring service is needed.
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private static instance: Logger;
  private debug: boolean;

  private constructor(debug = false) {
    this.debug = debug;
  }

  static getInstance(debug = false): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(debug);
    }
    return Logger.instance;
  }

  static configure(debug: boolean): void {
    Logger.getInstance().debug = debug;
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARN', message);
  }

  error(message: string, err?: Error): void {
    this.log('ERROR', message);
    if (err && this.debug) {
      process.stderr.write(err.stack + '\n');
    }
  }

  dbg(message: string): void {
    if (this.debug) this.log('DEBUG', message);
  }

  private log(level: LogLevel, message: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.padEnd(5)}] ${message}`;
    if (level === 'ERROR' || level === 'WARN') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}
