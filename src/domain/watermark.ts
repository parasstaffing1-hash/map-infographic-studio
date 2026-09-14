/**
 * A customer-owned watermark that can be embedded into visual exports.
 *
 * The image is kept as a data URL so the browser, canvas exporter, SVG
 * exporter, and server project document all use the same asset. Uploads are
 * deliberately capped because project documents are persisted in browser
 * storage and can also be sent to the API.
 */
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export type WatermarkSettings = {
  enabled: boolean;
  dataUrl?: string;
  fileName?: string;
  text?: string;
  position: WatermarkPosition;
  opacity: number;
  size: number;
};

export const MAX_WATERMARK_BYTES = 2 * 1024 * 1024;

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  position: 'bottom-right',
  opacity: 0.72,
  size: 12,
};

/** The build-time entitlement hook. The API can replace this with an account plan later. */
export function hasPaidWatermarkEntitlement(plan?: string | null) {
  const configuredPlan = plan ?? (import.meta.env?.VITE_VIZBRIDGE_PLAN as string | undefined) ?? 'pro';
  return configuredPlan.toLowerCase() !== 'free';
}

export function normalizeWatermark(value: unknown): WatermarkSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_WATERMARK };
  const record = value as Record<string, unknown>;
  const position = record.position;
  return {
    ...DEFAULT_WATERMARK,
    enabled: record.enabled === true,
    dataUrl: typeof record.dataUrl === 'string' ? record.dataUrl : undefined,
    fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    position: position === 'top-left' || position === 'top-right' || position === 'bottom-left' || position === 'bottom-right' || position === 'center'
      ? position
      : DEFAULT_WATERMARK.position,
    opacity: clampNumber(record.opacity, 0.05, 1, DEFAULT_WATERMARK.opacity),
    size: clampNumber(record.size, 4, 32, DEFAULT_WATERMARK.size),
  };
}

export function hasWatermarkContent(settings: WatermarkSettings) {
  return Boolean(settings.dataUrl || settings.text?.trim());
}

export function readWatermarkFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Choose a PNG, JPG, WebP, or SVG image.'));
  if (file.size > MAX_WATERMARK_BYTES) return Promise.reject(new Error('Watermarks must be 2 MB or smaller.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the watermark image.'));
    reader.onerror = () => reject(new Error('Could not read the watermark image.'));
    reader.readAsDataURL(file);
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
