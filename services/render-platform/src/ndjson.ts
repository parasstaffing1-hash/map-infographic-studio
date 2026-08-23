import { ManifestRecordSchema, type ManifestRecord } from './contracts.js';

export function manifestUrl(urlTemplate: string, shardIndex: number) {
  return urlTemplate.replace('{shard}', String(shardIndex).padStart(6, '0'));
}

export async function* readManifest(response: Response, maximumRecords: number): AsyncGenerator<ManifestRecord> {
  if (!response.ok || !response.body) throw new Error(`Manifest request failed with ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let count = 0;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      count += 1;
      if (count > maximumRecords) throw new Error(`Manifest shard exceeds ${maximumRecords} records`);
      yield ManifestRecordSchema.parse(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) {
    count += 1;
    if (count > maximumRecords) throw new Error(`Manifest shard exceeds ${maximumRecords} records`);
    yield ManifestRecordSchema.parse(JSON.parse(buffer));
  }
}
