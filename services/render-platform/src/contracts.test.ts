import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { BatchRenderRequestSchema, ManifestRecordSchema, RenderTaskSchema } from './contracts.js';

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
});
