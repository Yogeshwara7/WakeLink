import type { Request, Response, NextFunction } from 'express';

/**
 * Simple request logger for the dev backend.
 * Logs method, path, status, and duration.
 * Does NOT log request bodies (may contain pairing codes).
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const ts = new Date().toISOString();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const line = `[${ts}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`;
    if (res.statusCode >= 400) {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  });

  next();
}
