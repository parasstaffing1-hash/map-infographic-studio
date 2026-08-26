import { z } from 'zod';
import { ViewModeSchema } from './contracts.js';
import { ProjectDocumentSchema } from './project-document.js';

export const VideoFormatSchema = z.enum(['mp4', 'webm', 'gif']);
export const VideoPresetSchema = z.enum(['landscape-1080', 'vertical-1080', 'square-1080', 'landscape-4k']);
export const VideoModeSchema = z.enum(['year-choropleth', 'bar-race', 'camera-tour', 'counter']);
export const TransitionSchema = z.enum(['none', 'fade', 'wipe']);

export const AudioCategorySchema = z.enum(['cinematic', 'stats-race', 'historical', 'lofi', 'minimal']);

export const AudioTrackSpecSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().max(160),
  source: z.enum(['preset', 'custom', 'none']).default('preset'),
  category: AudioCategorySchema.optional(),
  audioData: z.string().optional(),
  volume: z.number().min(0).max(1).default(0.75),
  fadeInSeconds: z.number().min(0).max(30).default(1.0),
  fadeOutSeconds: z.number().min(0).max(30).default(2.0),
  loop: z.boolean().default(true),
});

export const VideoSpecSchema = z.object({
  mode: VideoModeSchema.default('year-choropleth'),
  preset: VideoPresetSchema.default('landscape-1080'),
  format: VideoFormatSchema.default('mp4'),
  durationSeconds: z.number().min(1).max(300).default(12),
  fps: z.number().int().min(1).max(60).default(30),
  introSeconds: z.number().min(0).max(20).default(1.5),
  outroSeconds: z.number().min(0).max(20).default(1.5),
  transition: TransitionSchema.default('fade'),
  showTitle: z.boolean().default(true),
  showSource: z.boolean().default(true),
  showLogo: z.boolean().default(false),
  raceSize: z.number().int().min(1).max(30).default(10),
  loop: z.boolean().default(false),
  audioTrack: AudioTrackSpecSchema.optional(),
}).strict();

/**
 * The full render request. `document` is the single versioned project schema the
 * editor, the still renderer and the video renderer all share, so a rendered
 * frame carries the same composition, chart overrides, brand kit, annotations,
 * filters and attribution the author sees on screen.
 *
 * `viewMode` and `compositionId` stay at the top level because the renderer needs
 * them to build the page URL before the document is loaded; when present in the
 * document they must agree, and the document wins.
 */
export const VideoRenderRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  templateId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  viewMode: ViewModeSchema,
  compositionId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).default('map-only'),
  document: ProjectDocumentSchema,
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
  /** Storage key of the finished file. The download URL is minted on read. */
  outputKey?: string;
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
