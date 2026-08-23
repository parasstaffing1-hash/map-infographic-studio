import { z } from 'zod';

const SafeIdentifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const HttpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Only HTTP(S) URLs are accepted');

export const ViewModeSchema = z.enum(['world', 'india', 'usa', 'china', 'india-districts', 'india-assembly', 'india-parliament', 'usa-counties', 'usa-state-house', 'usa-congress', 'china-prefectures', 'china-counties', 'china-npc']);
export const RenderFormatSchema = z.enum(['png', 'jpeg']);

export const BatchRenderRequestSchema = z.object({
  templateId: SafeIdentifier,
  viewMode: ViewModeSchema,
  idempotencyKey: z.string().min(8).max(200),
  manifest: z.object({
    urlTemplate: HttpUrl.refine((value) => value.includes('{shard}'), 'Manifest URL must contain {shard}'),
    shardCount: z.number().int().min(1).max(100_000),
    expectedRecords: z.number().int().min(1).max(10_000_000),
  }),
  output: z.object({
    format: RenderFormatSchema.default('png'),
    width: z.number().int().min(320).max(4096).default(1920),
    height: z.number().int().min(320).max(4096).default(1080),
    scale: z.number().min(1).max(3).default(1),
    prefix: z.string().max(240).regex(/^[a-zA-Z0-9/_-]*$/).default('renders'),
  }),
}).strict();

export const StoredProjectSchema = z.object({
  rows: z.array(z.object({
    id: z.string().max(200),
    region: z.string().min(1).max(300),
    value: z.union([z.string().max(500), z.number().finite()]),
    year: z.string().max(80).optional(),
    parent: z.string().max(300).optional(),
    raw: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })).max(100_000),
  config: z.record(z.unknown()),
  annotations: z.array(z.record(z.unknown())).max(200).default([]),
  currentYear: z.string().max(80).optional(),
}).strict();

export const ManifestRecordSchema = z.object({
  id: SafeIdentifier,
  project: StoredProjectSchema,
  viewMode: ViewModeSchema.optional(),
  outputName: z.string().min(1).max(180).regex(/^[a-zA-Z0-9._-]+$/).optional(),
}).strict();

export const RenderTaskSchema = z.object({
  batchId: SafeIdentifier,
  templateId: SafeIdentifier,
  record: ManifestRecordSchema,
  viewMode: ViewModeSchema,
  output: z.object({
    format: RenderFormatSchema,
    width: z.number().int().min(320).max(4096),
    height: z.number().int().min(320).max(4096),
    scale: z.number().min(1).max(3),
    prefix: z.string().max(240).regex(/^[a-zA-Z0-9/_-]*$/),
  }),
}).strict();

export type BatchRenderRequest = z.infer<typeof BatchRenderRequestSchema>;
export type ManifestRecord = z.infer<typeof ManifestRecordSchema>;

export type ShardJobData = {
  batchId: string;
  shardIndex: number;
  request: BatchRenderRequest;
};

export type RenderTask = z.infer<typeof RenderTaskSchema>;

export type BatchStatus = {
  batchId: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed' | 'canceled';
  totalShards: number;
  completedShards: number;
  failedShards: number;
  completedOutputs: number;
  failedOutputs: number;
  expectedRecords: number;
  createdAt: string;
  updatedAt: string;
};
