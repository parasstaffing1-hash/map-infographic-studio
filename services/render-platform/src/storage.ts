import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PlatformConfig } from './config.js';

export type ObjectStore = { put: (key: string, body: Buffer, contentType: string) => Promise<string> };

export function createObjectStore(config: PlatformConfig): ObjectStore {
  if (config.S3_BUCKET) {
    const client = new S3Client({ region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: config.S3_FORCE_PATH_STYLE });
    return {
      async put(key, body, contentType) {
        await client.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
        return `s3://${config.S3_BUCKET}/${key}`;
      },
    };
  }
  const outputRoot = resolve(config.OUTPUT_DIRECTORY);
  return {
    async put(key, body) {
      const path = resolve(outputRoot, key);
      if (!path.startsWith(`${outputRoot}\\`) && path !== outputRoot && !path.startsWith(`${outputRoot}/`)) throw new Error('Unsafe output key');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return path;
    },
  };
}
