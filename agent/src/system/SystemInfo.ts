import * as os from 'os';

/**
 * SystemInfo — collects OS and hardware information about the host PC.
 *
 * Only collects what is needed for the heartbeat and status reporting.
 * Does NOT collect personal information, user files, or browsing data.
 */
export interface SystemSnapshot {
  platform: string;       // 'win32'
  osVersion: string;      // e.g. 'Windows 10 Pro 22H2'
  hostname: string;       // Machine hostname (not a permanent ID)
  arch: string;           // 'x64', 'arm64'
  totalMemoryMb: number;
  freeMemoryMb: number;
  uptimeSeconds: number;
  nodeVersion: string;
  capturedAt: string;     // ISO-8601
}

export class SystemInfo {
  /**
   * Capture a snapshot of current system state.
   * All values are read from Node's built-in `os` module — no native addons.
   */
  static capture(): SystemSnapshot {
    return {
      platform:       process.platform,
      osVersion:      `${os.type()} ${os.release()}`,
      hostname:       os.hostname(),
      arch:           os.arch(),
      totalMemoryMb:  Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb:   Math.round(os.freemem()  / 1024 / 1024),
      uptimeSeconds:  Math.round(os.uptime()),
      nodeVersion:    process.version,
      capturedAt:     new Date().toISOString(),
    };
  }

  /** Returns a compact human-readable summary for logging. */
  static summary(): string {
    const s = SystemInfo.capture();
    return `${s.osVersion} | ${s.arch} | ${s.freeMemoryMb}/${s.totalMemoryMb} MB free | uptime ${s.uptimeSeconds}s`;
  }
}
