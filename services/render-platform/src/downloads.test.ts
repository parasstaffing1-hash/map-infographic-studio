import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { assertSafeObjectKey, contentTypeForKey, createObjectStore } from './storage.js';
import { downloadUrlFor, jobIdFromKey } from './routes-downloads.js';

function configWith(overrides: Record<string, string>) {
  return loadConfig({
    NODE_ENV: 'test',
    API_KEYS: 'test-api-key-value',
    INTERNAL_RENDER_TOKEN: 'test-internal-token',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

describe('object key safety', () => {
  it('accepts ordinary render keys', () => {
    expect(assertSafeObjectKey('videos/abc123.mp4')).toBe('videos/abc123.mp4');
    expect(assertSafeObjectKey('renders/batch-1/out_2.png')).toBe('renders/batch-1/out_2.png');
  });

  it('rejects traversal, absolute paths and shell characters', () => {
    for (const bad of ['../secrets.env', 'videos/../../etc/passwd', '/etc/passwd', 'videos/a b.mp4', 'videos/$(id).mp4', 'videos/a;rm.mp4', '', 'videos/a\\b.mp4']) {
      expect(() => assertSafeObjectKey(bad), bad).toThrow(/Invalid object key/);
    }
  });

  it('rejects an over-long key', () => {
    expect(() => assertSafeObjectKey(`videos/${'a'.repeat(600)}.mp4`)).toThrow();
  });
});

describe('content types', () => {
  it('maps each rendered format', () => {
    expect(contentTypeForKey('a/b.mp4')).toBe('video/mp4');
    expect(contentTypeForKey('a/b.webm')).toBe('video/webm');
    expect(contentTypeForKey('a/b.gif')).toBe('image/gif');
    expect(contentTypeForKey('a/b.bin')).toBe('application/octet-stream');
  });
});

describe('local object store', () => {
  it('round-trips a file and refuses to escape the output root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'map-studio-store-'));
    try {
      const store = createObjectStore(configWith({ OUTPUT_DIRECTORY: directory }));
      expect(store.kind).toBe('local');

      const payload = Buffer.from('video-bytes');
      await store.put('videos/job1.mp4', payload, 'video/mp4');
      expect(await readFile(join(directory, 'videos', 'job1.mp4'))).toEqual(payload);

      const object = await store.get('videos/job1.mp4');
      expect(object.contentType).toBe('video/mp4');
      expect(object.contentLength).toBe(payload.length);

      await expect(store.put('../escape.mp4', payload, 'video/mp4')).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('cannot presign, so callers fall back to streaming', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'map-studio-store-'));
    try {
      const store = createObjectStore(configWith({ OUTPUT_DIRECTORY: directory }));
      expect(await store.presign('videos/job1.mp4', 900)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('S3 presigning', () => {
  const s3Config = configWith({
    S3_BUCKET: 'map-studio-renders',
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000',
    S3_FORCE_PATH_STYLE: 'true',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
  });

  it('signs against the browser-reachable endpoint, not the internal one', async () => {
    const store = createObjectStore(s3Config);
    expect(store.kind).toBe('s3');
    const url = await store.presign('videos/job1.mp4', 900);
    expect(url).toBeTruthy();
    // The internal Docker hostname must never reach a browser.
    expect(url).not.toContain('minio:9000');
    expect(url).toContain('127.0.0.1:9000');
    expect(url).toContain('videos/job1.mp4');
  });

  it('produces a time-limited signature rather than a durable public link', async () => {
    const store = createObjectStore(s3Config);
    const url = (await store.presign('videos/job1.mp4', 900)) ?? '';
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=900');
    expect(url).toContain('X-Amz-Credential=');
  });

  it('honours the configured expiry', async () => {
    const store = createObjectStore(s3Config);
    expect((await store.presign('videos/job1.mp4', 60)) ?? '').toContain('X-Amz-Expires=60');
  });

  it('refuses to sign an unsafe key', async () => {
    const store = createObjectStore(s3Config);
    await expect(store.presign('../../secret.env', 900)).rejects.toThrow(/Invalid object key/);
  });
});

describe('downloadUrlFor', () => {
  it('returns a presigned URL when the backend supports it', async () => {
    const config = configWith({
      S3_BUCKET: 'map-studio-renders',
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000',
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
      DOWNLOAD_URL_TTL_SECONDS: '600',
    });
    const link = await downloadUrlFor(createObjectStore(config), config, 'videos/job1.mp4');
    expect(link.mode).toBe('presigned');
    expect(link.expiresInSeconds).toBe(600);
    expect(link.url).toContain('X-Amz-Signature=');
  });

  it('falls back to the authenticated streaming endpoint on local disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'map-studio-store-'));
    try {
      const config = configWith({ OUTPUT_DIRECTORY: directory, APP_API_PUBLIC_URL: 'https://api.example.com' });
      const link = await downloadUrlFor(createObjectStore(config), config, 'videos/job1.mp4');
      expect(link.mode).toBe('stream');
      expect(link.url).toBe('https://api.example.com/v1/video-jobs/job1/download');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recovers the job id from a storage key', () => {
    expect(jobIdFromKey('videos/abc123.mp4')).toBe('abc123');
    expect(jobIdFromKey('nested/prefix/xyz.webm')).toBe('xyz');
    expect(jobIdFromKey('plain.gif')).toBe('plain');
  });
});
