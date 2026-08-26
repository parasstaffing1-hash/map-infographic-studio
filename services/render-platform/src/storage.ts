import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { PlatformConfig } from './config.js';

export type StoredObject = {
  body: Readable;
  contentType: string;
  contentLength?: number;
};

export type ObjectStore = {
  put: (key: string, body: Buffer, contentType: string) => Promise<string>;
  /**
   * A time-limited URL a browser can fetch directly, or null when the backend
   * cannot presign (local disk). Callers fall back to the streaming endpoint.
   */
  presign: (key: string, expiresInSeconds: number) => Promise<string | null>;
  /** Streams the object back through the API, used as the fallback download path. */
  get: (key: string) => Promise<StoredObject>;
  kind: 's3' | 'local';
};

/** Only these characters may appear in an object key. */
const SAFE_KEY = /^[a-zA-Z0-9._\-/]+$/;

/**
 * Object keys come from job ids and operator-configured prefixes, but they are
 * still checked: a key must not escape its prefix or contain traversal.
 */
export function assertSafeObjectKey(key: string) {
  if (!key || key.length > 512) throw new Error('Invalid object key');
  if (key.startsWith('/') || key.includes('..')) throw new Error('Invalid object key');
  if (!SAFE_KEY.test(key)) throw new Error('Invalid object key');
  return key;
}

export function createObjectStore(config: PlatformConfig): ObjectStore {
  if (config.S3_BUCKET) {
    const bucket = config.S3_BUCKET;
    // Explicit credentials when configured, otherwise the AWS default chain.
    const accessKeyId = config.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = config.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
    const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
    const client = new S3Client({ region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: config.S3_FORCE_PATH_STYLE, credentials });
    // Presigning must target the endpoint the BROWSER can reach. Inside Docker
    // the worker talks to http://minio:9000, which no browser can resolve, so a
    // separate public endpoint is signed against when one is configured.
    const publicClient = config.S3_PUBLIC_ENDPOINT && config.S3_PUBLIC_ENDPOINT !== config.S3_ENDPOINT
      ? new S3Client({ region: config.S3_REGION, endpoint: config.S3_PUBLIC_ENDPOINT, forcePathStyle: config.S3_FORCE_PATH_STYLE, credentials })
      : client;

    return {
      kind: 's3',
      async put(key, body, contentType) {
        assertSafeObjectKey(key);
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
        return `s3://${bucket}/${key}`;
      },
      async presign(key, expiresInSeconds) {
        assertSafeObjectKey(key);
        return getSignedUrl(publicClient, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
      },
      async get(key) {
        assertSafeObjectKey(key);
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!response.Body) throw new Error('Object has no body');
        return {
          body: response.Body as Readable,
          contentType: response.ContentType ?? contentTypeForKey(key),
          contentLength: response.ContentLength,
        };
      },
    };
  }

  const outputRoot = resolve(config.OUTPUT_DIRECTORY);
  const resolveKey = (key: string) => {
    assertSafeObjectKey(key);
    const path = resolve(outputRoot, key);
    if (path !== outputRoot && !path.startsWith(`${outputRoot}\\`) && !path.startsWith(`${outputRoot}/`)) {
      throw new Error('Unsafe output key');
    }
    return path;
  };

  return {
    kind: 'local',
    async put(key, body) {
      const path = resolveKey(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return path;
    },
    // Local disk cannot be presigned; the API streams it instead.
    async presign() {
      return null;
    },
    async get(key) {
      const path = resolveKey(key);
      const info = await stat(path);
      return { body: createReadStream(path), contentType: contentTypeForKey(key), contentLength: info.size };
    },
  };
}

export function contentTypeForKey(key: string) {
  if (key.endsWith('.mp4')) return 'video/mp4';
  if (key.endsWith('.webm')) return 'video/webm';
  if (key.endsWith('.gif')) return 'image/gif';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpeg') || key.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}
