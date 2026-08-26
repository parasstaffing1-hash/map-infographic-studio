import { z } from 'zod';
import { StoredProjectSchema, ViewModeSchema } from './contracts.js';

export const VideoFormatSchema = z.enum(['mp4', 'webm', 'gif']);
export const VideoPresetSchema = z.enum(['landscape-1080', 'vertical-1080', 'square-1080', 'landscape-4k']);
export const VideoModeSchema = z.enum(['year-choropleth', 'bar-race', 'camera-tour', 'counter']);
export const TransitionSchema = z.enum(['none', 'fade', 'wipe']);

export const VideoSpecSchema = z.object({
  mode: VideoModeSchema.default('year-choropleth'),
  preset: VideoPresetSchema.default('landscape-1080'),
  format: VideoFormatSchema.default('mp4'),
  durationSeconds: z.number().min(1).max(180).default(12),
  fps: z.number().int().min(1).max(60).default(30),
  introSeconds: z.number().min(0).max(20).default(1.5),
  outroSeconds: z.number().min(0).max(20).default(1.5),
  transition: TransitionSchema.default('fade'),
  showTitle: z.boolean().default(true),
  showSource: z.boolean().default(true),
  showLogo: z.boolean().default(false),
  raceSize: z.number().int().min(1).max(30).default(10),
  loop: z.boolean().default(false),
}).strict();

export const VideoRenderRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  templateId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  viewMode: ViewModeSchema,
  compositionId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).default('map-only'),
  project: StoredProjectSchema,
  spec: VideoSpecSchema,
  outputPrefix: z.string().max(240).regex(/^[a-zA-Z0-9/_-]*$/).default('videos'),
}).strict();

export type VideoRenderRequest = z.infer<typeof VideoRenderRequestSchema>;
export type VideoSpecInput = z.infer<typeof VideoSpecSchema>;

export type VideoJobData = {
  jobId: string;
  request: VideoRenderRequest;
};

export type VideoJobStatus = {
  jobId: string;
  status: 'queued' | 'rendering' | 'encoding' | 'complete' | 'failed' | 'canceled';
  framesRendered: number;
  totalFrames: number;
  format: string;
  createdAt: string;
  updatedAt: string;
  outputUri?: string;
  downloadUrl?: string;
  error?: string;
  attempts: number;
};

export const VIDEO_DIMENSIONS: Record<z.infer<typeof VideoPresetSchema>, { width: number; height: number }> = {
  'landscape-1080': { width: 1920, height: 1080 },
  'vertical-1080': { width: 1080, height: 1920 },
  'square-1080': { width: 1080, height: 1080 },
  'landscape-4k': { width: 3840, height: 2160 },
};

export function videoFrameCount(spec: VideoSpecInput) {
  return Math.max(1, Math.round(spec.durationSeconds * spec.fps));
}

/**
 * Caps the pixel budget of a single job so one 4K/60fps request cannot occupy a
 * worker indefinitely.
 */
export function pixelBudget(spec: VideoSpecInput) {
  const { width, height } = VIDEO_DIMENSIONS[spec.preset];
  return width * height * videoFrameCount(spec);
}

export const MAX_PIXEL_BUDGET = 3840 * 2160 * 1800;

export function withinPixelBudget(spec: VideoSpecInput) {
  return pixelBudget(spec) <= MAX_PIXEL_BUDGET;
}
