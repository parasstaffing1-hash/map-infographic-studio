import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/** Only the fields the database layer cares about, so tests can pass a literal. */
export type DatabaseConfig = { DATABASE_URL?: string | undefined };

export function createPool(config: DatabaseConfig): Pool | null {
  if (!config.DATABASE_URL) return null;
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    // A cold database (first boot, container still warming) can take a while to
    // hand out a connection; 10s was short enough to abort a migration midway.
    connectionTimeoutMillis: 60_000,
    statement_timeout: 120_000,
  });
}

export async function withTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `src/` at dev time and `dist/` after a build sit at the same depth. */
export const MIGRATIONS_DIRECTORY = path.resolve(HERE, '..', '..', '..', 'database', 'migrations');

export type MigrationOutcome = {
  applied: string[];
  skipped: { name: string; reason: string }[];
  alreadyApplied: string[];
};

/**
 * Applies every `.sql` file in `database/migrations` in filename order, each in
 * its own transaction, recording the filename in `schema_migrations` so a second
 * run is a no-op.
 *
 * Missing-extension tolerance: `001_foundation.sql` opens with
 * `CREATE EXTENSION IF NOT EXISTS postgis`, and PostGIS is not present on a
 * stock `postgres:16-alpine` image. Rather than aborting the whole run — which
 * would stop the application tables in `002` from ever being created — a
 * migration that fails *because an extension is unavailable* is logged, recorded
 * with `skipped = true`, and the run continues with the next file. The failing
 * transaction is rolled back, so nothing partial is left behind.
 *
 * A skipped migration is NOT retried automatically on later runs; once the
 * extension is installed, delete its `schema_migrations` row to force a retry.
 */
export async function runMigrations(
  pool: Pool,
  options: { directory?: string; logger?: { info: (message: string) => void; warn: (message: string) => void } } = {},
): Promise<MigrationOutcome> {
  const directory = options.directory ?? MIGRATIONS_DIRECTORY;
  const logger = options.logger ?? { info: () => undefined, warn: () => undefined };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      skipped BOOLEAN NOT NULL DEFAULT FALSE,
      skip_reason TEXT
    )
  `);

  const entries = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const seen = new Set(recorded.rows.map((row) => row.name));

  const outcome: MigrationOutcome = { applied: [], skipped: [], alreadyApplied: [] };

  for (const name of entries) {
    if (seen.has(name)) {
      outcome.alreadyApplied.push(name);
      continue;
    }
    const sql = await readFile(path.join(directory, name), 'utf8');
    try {
      await withTransaction(pool, async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      });
      outcome.applied.push(name);
      logger.info(`migration applied: ${name}`);
    } catch (error) {
      const reason = missingExtensionReason(error);
      if (!reason) throw error;
      await pool.query(
        'INSERT INTO schema_migrations (name, skipped, skip_reason) VALUES ($1, TRUE, $2) ON CONFLICT (name) DO NOTHING',
        [name, reason],
      );
      outcome.skipped.push({ name, reason });
      logger.warn(`migration skipped: ${name} (${reason})`);
    }
  }

  return outcome;
}

/**
 * Returns a human reason when the failure is "this PostgreSQL build has no such
 * extension", and null for every other error — a syntax error or a constraint
 * violation must still abort the run loudly.
 */
function missingExtensionReason(error: unknown): string | null {
  const candidate = error as { code?: string; message?: string } | null;
  if (!candidate) return null;
  const message = String(candidate.message ?? '');
  const code = candidate.code;
  const looksLikeExtension =
    /could not open extension control file/i.test(message) ||
    /extension "[^"]+" is not available/i.test(message) ||
    (/\bextension\b/i.test(message) && (code === '58P01' || code === '0A000'));
  if (!looksLikeExtension) return null;
  return `required extension unavailable: ${message.split('\n')[0]}`;
}
