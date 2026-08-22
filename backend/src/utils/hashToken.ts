import * as crypto from 'crypto';

/**
 * Hash a relay token with SHA-256 for safe storage.
 * The raw token is only held by the relay process.
 * NEVER log raw tokens.
 */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Verify a submitted token against its stored hash. */
export function verifyToken(raw: string, hash: string): boolean {
  return hashToken(raw) === hash;
}
