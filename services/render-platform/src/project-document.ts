import { z } from 'zod';

/**
 * Server-side mirror of `src/domain/projectDocument.ts`'s `ProjectDocument`.
 *
 * Strict at the top level so a typo in a field name is rejected rather than
 * silently persisted, and permissive (passthrough) inside `config`, rows,
 * annotations, filters and the video spec so the editor can evolve those shapes
 * without a coordinated backend deploy.
 */

const Loose = () => z.object({}).passthrough();

export const MapGeographySchema = z
  .object({
    viewMode: z.string().min(1).max(80),
    districtScope: z.string().max(300).optional(),
    focusPlace: z.string().max(300).optional(),
    placeContext: z.string().max(300).optional(),
    selectedIds: z.array(z.string().max(300)).max(100_000).default([]),
  })
  .passthrough();

export const MapPresentationSchema = z
  .object({
    style: Loose(),
    hiddenLayers: z.record(z.boolean()).default({}),
  })
  .passthrough();

export const BrandKitSnapshotSchema = z
  .object({
    id: z.string().max(200),
    name: z.string().max(300),
    colors: z.array(z.string().max(120)).max(64).default([]),
    fontFamily: z.string().max(200).optional(),
    sourcePrefix: z.string().max(300).optional(),
    logoDataUrl: z.string().max(4_000_000).optional(),
    logoObjectKey: z.string().max(1_000).optional(),
  })
  .passthrough();

const DashboardBlockSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum(['kpi', 'chart', 'map', 'table', 'narrative', 'three']),
    title: z.string().max(300),
  })
  .passthrough();

const DashboardDocumentSchema = z
  .object({
    name: z.string().min(1).max(300),
    blocks: z.array(DashboardBlockSchema).max(200),
    activeTemplate: z.string().max(200).optional(),
  })
  .passthrough();

const WatermarkSchema = z
  .object({
    enabled: z.boolean().default(false),
    dataUrl: z.string().max(3_000_000).optional(),
    fileName: z.string().max(300).optional(),
    text: z.string().max(300).optional(),
    position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).default('bottom-right'),
    opacity: z.number().min(0.05).max(1).default(0.72),
    size: z.number().min(4).max(32).default(12),
  })
  .passthrough();

export const ProjectDocumentSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(1_000),
    name: z.string().min(1).max(300),
    geography: MapGeographySchema,
    presentation: MapPresentationSchema,
    compositionId: z.string().min(1).max(200),
    chartOverrides: z.record(Loose()).default({}),
    config: Loose(),
    rows: z.array(Loose()).max(100_000),
    annotations: z.array(Loose()).max(5_000).default([]),
    currentYear: z.string().max(80).optional(),
    datasetMeta: Loose(),
    regionOverrides: z.record(z.unknown()).default({}),
    filters: z.array(Loose()).max(500).default([]),
    brandKit: BrandKitSnapshotSchema.optional(),
    videoSpec: Loose(),
    dashboard: DashboardDocumentSchema.optional(),
    watermark: WatermarkSchema.optional(),
  })
  .strict();

export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
