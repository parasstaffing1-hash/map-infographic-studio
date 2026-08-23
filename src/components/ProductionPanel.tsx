import { Activity, Boxes, CheckCircle2, Factory, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ViewMode } from '../domain/types';

type BatchStatus = {
  batchId: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed' | 'canceled';
  totalShards: number;
  completedShards: number;
  failedShards: number;
  completedOutputs: number;
  failedOutputs: number;
  expectedRecords: number;
};

const PRODUCTION_VIEWS: ViewMode[] = ['world', 'india', 'usa', 'china', 'india-districts', 'india-assembly', 'india-parliament', 'usa-counties', 'usa-state-house', 'usa-congress', 'china-prefectures', 'china-counties', 'china-npc'];

function productionView(viewMode: ViewMode): ViewMode {
  return PRODUCTION_VIEWS.includes(viewMode) ? viewMode : 'india';
}

export function ProductionPanel({ templateId, viewMode, onToast }: { templateId: string; viewMode: ViewMode; onToast: (message: string) => void }) {
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_PRODUCTION_API_URL ?? 'http://127.0.0.1:8787');
  const [apiKey, setApiKey] = useState('');
  const [manifest, setManifest] = useState('https://data.example.com/map-batches/{shard}.ndjson');
  const [shardCount, setShardCount] = useState(100);
  const [expectedRecords, setExpectedRecords] = useState(100_000);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [status, setStatus] = useState<BatchStatus>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const resolvedView = useMemo(() => productionView(viewMode), [viewMode]);

  const loadStatus = async (batchId: string) => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/render-jobs/${batchId}`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`Status request failed (${response.status})`);
    setStatus(await response.json() as BatchStatus);
  };

  useEffect(() => {
    if (!status || !['queued', 'running'].includes(status.status) || !apiKey) return;
    const timer = window.setInterval(() => void loadStatus(status.batchId).catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [apiKey, apiUrl, status?.batchId, status?.status]);

  const submit = async () => {
    setError('');
    if (!apiKey.trim()) { setError('Add an API key before submitting.'); return; }
    if (!manifest.includes('{shard}')) { setError('Manifest URL must include the {shard} placeholder.'); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/render-jobs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          templateId: templateId.replace(/[^a-zA-Z0-9._:-]/g, '-') || 'custom-map',
          viewMode: resolvedView,
          idempotencyKey: crypto.randomUUID(),
          manifest: { urlTemplate: manifest, shardCount, expectedRecords },
          output: { format, width: 1920, height: 1080, scale: 1, prefix: 'renders' },
        }),
      });
      const payload = await response.json() as BatchStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Submission failed (${response.status})`);
      setStatus(payload);
      onToast(`Production batch ${payload.batchId} accepted`);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
    } finally {
      setSubmitting(false);
    }
  };

  const finishedShards = status ? status.completedShards + status.failedShards : 0;
  const progress = status ? Math.min(100, Math.round((finishedShards / Math.max(1, status.totalShards)) * 100)) : 0;

  return <div className="panel-content production-panel">
    <div className="panel-heading"><div className="panel-title"><span className="panel-title-icon production-title-icon"><Factory size={16} /></span><div><h2>Production factory</h2><span>Sharded, queue-based batch rendering</span></div></div></div>

    <div className="production-capacity"><Boxes size={17} /><div><strong>Up to 10 million records per batch</strong><span>Scale throughput by adding stateless workers and renderers.</span></div></div>

    <label className="production-field"><span>Production API</span><input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} /></label>
    <label className="production-field"><span>API key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Stored only in this panel" /></label>
    <label className="production-field"><span>Sharded manifest URL</span><input value={manifest} onChange={(event) => setManifest(event.target.value)} /></label>

    <div className="production-grid">
      <label className="production-field"><span>Shards</span><input type="number" min={1} max={10000} value={shardCount} onChange={(event) => setShardCount(Math.max(1, Number(event.target.value)))} /></label>
      <label className="production-field"><span>Records</span><input type="number" min={1} max={10000000} value={expectedRecords} onChange={(event) => setExpectedRecords(Math.max(1, Number(event.target.value)))} /></label>
    </div>
    <div className="production-grid">
      <label className="production-field"><span>Map level</span><input value={resolvedView} readOnly /></label>
      <label className="production-field"><span>Format</span><select value={format} onChange={(event) => setFormat(event.target.value as 'png' | 'jpeg')}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
    </div>

    <button className="primary-button wide production-submit" disabled={submitting} onClick={() => void submit()}><Rocket size={14} /> {submitting ? 'Submitting…' : 'Start production batch'}</button>
    {error && <div className="production-error">{error}</div>}

    {status && <div className="production-status">
      <div className="production-status-head"><span><Activity size={13} /> {status.status}</span><button onClick={() => void loadStatus(status.batchId)} aria-label="Refresh batch status"><RefreshCw size={13} /></button></div>
      <div className="production-progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="production-stats"><span><b>{progress}%</b> shards</span><span><b>{status.completedOutputs.toLocaleString()}</b> complete</span><span><b>{status.failedOutputs.toLocaleString()}</b> failed</span></div>
      <code>{status.batchId}</code>
    </div>}

    <div className="panel-note production-note"><ShieldCheck size={15} /><span>API keys are never persisted by the editor. Production manifests must come from an administrator-approved host.</span></div>
    <div className="panel-note production-note"><CheckCircle2 size={15} /><span>Jobs are idempotent, retryable, observable, and safe to distribute across many machines.</span></div>
  </div>;
}
