import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from './db.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters. Stored alongside the hash so they can be raised later. */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1_024 * 1_024;

/** `scrypt$N$r$p$saltBase64$hashBase64` — self-describing, no extra dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAX_MEMORY });
  } catch {
    return false;
  }
  // Lengths match by construction; timingSafeEqual still throws on a mismatch.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Only the digest is persisted, so a database leak does not hand out sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  sessionId: string;
};

export type CreatedSession = { id: string; token: string; expiresAt: Date };

export async function createSession(pool: Pool, userId: string, ttlHours: number): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  const inserted = await pool.query<{ id: string }>(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3) RETURNING id',
    [hashToken(token), userId, expiresAt],
  );
  return { id: inserted.rows[0]!.id, token, expiresAt };
}

export async function resolveSession(pool: Pool, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const result = await pool.query<{ session_id: string; user_id: string }>(
    `UPDATE sessions SET last_seen_at = now()
       WHERE token_hash = $1 AND expires_at > now()
       RETURNING id AS session_id, user_id`,
    [hashToken(token)],
  );
  const session = result.rows[0];
  if (!session) return null;
  const user = await pool.query<{ id: string; email: string; display_name: string | null }>(
    'SELECT id, email, display_name FROM users WHERE id = $1',
    [session.user_id],
  );
  const row = user.rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, sessionId: session.session_id };
}

export async function revokeSession(pool: Pool, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const result = await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  return (result.rowCount ?? 0) > 0;
}
