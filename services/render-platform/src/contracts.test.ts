import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { BatchRenderRequestSchema, ManifestRecordSchema, RenderTaskSchema } from './contracts.js';
import { databasePoolOptions } from './db.js';
import { createObjectStore } from './storage.js';

const project = {
  rows: [{ id: 'delhi', region: 'Delhi', value: 42, raw: { region: 'Delhi', value: 42 } }],
  config: { title: 'Population growth' },
  annotations: [],
};

describe('production contracts', () => {
  it('accepts a sharded multi-million-record batch', () => {
    const result = BatchRenderRequestSchema.parse({
      templateId: 'india-growth',
      viewMode: 'india',
      idempotencyKey: 'job-2026-08-23',
      manifest: { urlTemplate: 'https://data.example.com/{shard}.ndjson', shardCount: 2_000, expectedRecords: 2_000_000 },
      output: { format: 'png', width: 1920, height: 1080, scale: 1, prefix: 'renders' },
    });
    expect(result.manifest.expectedRecords).toBe(2_000_000);
  });

  it('rejects unsafe or unsharded requests', () => {
    expect(() => BatchRenderRequestSchema.parse({
      templateId: '../escape',
      viewMode: 'india',
      idempotencyKey: 'job-2026-08-23',
      manifest: { urlTemplate: 'https://data.example.com/one.ndjson', shardCount: 1, expectedRecords: 1 },
      output: { format: 'png', width: 1920, height: 1080, scale: 1, prefix: 'renders' },
    })).toThrow();
  });

  it('validates render tasks and project payloads', () => {
    const record = ManifestRecordSchema.parse({ id: 'india-001', project, outputName: 'india-growth-001' });
    const task = RenderTaskSchema.parse({ batchId: 'batch-001', templateId: 'india-growth', record, viewMode: 'india', output: { format: 'jpeg', width: 1280, height: 720, scale: 1, prefix: 'renders' } });
    expect(task.record.project.rows?.[0]?.region).toBe('Delhi');
  });

  it('parses false booleans without truthy-string coercion', () => {
    expect(loadConfig({ S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(loadConfig({ S3_FORCE_PATH_STYLE: 'true' }).S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('maps Cloudflare R2 aliases to the existing S3 storage config', async () => {
    const config = loadConfig({
      R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_BUCKET: 'map-studio-renders',
      R2_ACCESS_KEY_ID: 'r2-access',
      R2_SECRET_ACCESS_KEY: 'r2-secret',
    });
    expect(config.S3_BUCKET).toBe('map-studio-renders');
    expect(config.S3_REGION).toBe('auto');
    expect(config.S3_ENDPOINT).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
    expect(config.S3_ACCESS_KEY_ID).toBe('r2-access');
    expect(config.S3_SECRET_ACCESS_KEY).toBe('r2-secret');
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
    const signedUrl = await createObjectStore(config).presign('renders/test.png', 60);
    expect(signedUrl).toContain('r2.cloudflarestorage.com');
    expect(signedUrl).toContain('X-Amz-Signature=');
  });

  it('maps an Aiven URL and normalizes its sslmode for node-postgres', () => {
    const config = loadConfig({ AIVEN_POSTGRES_URL: 'postgres://avnadmin:secret@pg.aivencloud.com:12345/defaultdb?sslmode=require' });
    expect(config.DATABASE_URL).toBe('postgres://avnadmin:secret@pg.aivencloud.com:12345/defaultdb?sslmode=require');
    const options = databasePoolOptions({ DATABASE_URL: config.DATABASE_URL });
    expect(options).not.toBeNull();
    expect(options?.connectionString).not.toContain('sslmode=');
    expect(options?.ssl).toMatchObject({ rejectUnauthorized: false });
  });
});
