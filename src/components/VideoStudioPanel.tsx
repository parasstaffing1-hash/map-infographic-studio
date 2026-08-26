import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Film, Pause, Play, RotateCcw, Server, SkipBack, StepForward, X } from 'lucide-react';
import {
  DEFAULT_VIDEO_SPEC,
  estimatedFileSizeMb,
  frameState,
  totalFrames,
  VIDEO_FORMATS,
  VIDEO_PRESETS,
  videoDimensions,
  type VideoSpec,
} from '../domain/videoTimeline';
import type { DataRow, InfographicConfig } from '../domain/infographic';
import type { ViewMode } from '../domain/types';

type ServerJob = {
  jobId: string;
  status: 'queued' | 'rendering' | 'encoding' | 'complete' | 'failed' | 'canceled';
  framesRendered: number;
  totalFrames: number;
  downloadUrl?: string;
  error?: string;
};

type Props = {
  spec: VideoSpec;
  onSpec: (patch: Partial<VideoSpec>) => void;
  rows: DataRow[];
  config: InfographicConfig;
  years: string[];
  viewMode: ViewMode;
  compositionId: string;
  templateId: string;
  annotations: unknown[];
  currentYear?: string;
  previewFrame: number;
  onPreviewFrame: (frame: number) => void;
  onToast: (message: string) => void;
};

const PRODUCTION_VIEWS: ViewMode[] = ['world', 'india', 'usa', 'china', 'india-districts', 'india-assembly', 'india-parliament', 'usa-counties', 'usa-state-house', 'usa-congress', 'china-prefectures', 'china-counties', 'china-npc'];

export function VideoStudioPanel({ spec, onSpec, rows, config, years, viewMode, compositionId, templateId, annotations, currentYear, previewFrame, onPreviewFrame, onToast }: Props) {
  const [playing, setPlaying] = useState(false);
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_PRODUCTION_API_URL ?? 'http://127.0.0.1:8787');
  const [apiKey, setApiKey] = useState('');
  const [job, setJob] = useState<ServerJob | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const frameRef = useRef(previewFrame);
  const total = totalFrames(spec);
  const dimensions = videoDimensions(spec);
  const state = frameState(spec, previewFrame, rows, config, years);

  useEffect(() => { frameRef.current = previewFrame; }, [previewFrame]);

  useEffect(() => {
    if (!playing) return undefined;
    let handle = 0;
    let last = performance.now();
    const step = 1_000 / spec.fps;
    const tick = (time: number) => {
      if (time - last >= step) {
        const next = frameRef.current + 1;
        if (next >= total) {
          if (spec.loop) onPreviewFrame(0);
          else { setPlaying(false); return; }
        } else onPreviewFrame(next);
        last = time;
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [playing, spec.fps, spec.loop, total, onPreviewFrame]);

  // Poll a running server job until it settles.
  useEffect(() => {
    if (!job || !apiKey || !['queued', 'rendering', 'encoding'].includes(job.status)) return undefined;
    const timer = window.setInterval(() => { void pollJob(job.jobId); }, 2_500);
    return () => window.clearInterval(timer);
  }, [apiKey, apiUrl, job?.jobId, job?.status]);

  const base = () => apiUrl.replace(/\/$/, '');

  const pollJob = async (jobId: string) => {
    try {
      const response = await fetch(`${base()}/v1/video-jobs/${jobId}`, { headers: { authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`Status request failed (${response.status})`);
      const next = (await response.json()) as ServerJob;
      setJob(next);
      if (next.status === 'complete') onToast('Video render complete');
      if (next.status === 'failed') setError(next.error ?? 'The render failed');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const submit = async () => {
    setError('');
    if (!apiKey.trim()) { setError('Add an API key for the render service before submitting.'); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`${base()}/v1/video-jobs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          templateId: templateId.replace(/[^a-zA-Z0-9._:-]/g, '-') || 'custom-map',
          viewMode: PRODUCTION_VIEWS.includes(viewMode) ? viewMode : 'india',
          compositionId,
          project: { rows, config, annotations, currentYear },
          spec,
          outputPrefix: 'videos',
        }),
      });
      const payload = (await response.json()) as ServerJob & { error?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? payload.error ?? `Submission failed (${response.status})`);
      setJob(payload);
      onToast(`Video job ${payload.jobId} queued`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    await fetch(`${base()}/v1/video-jobs/${job.jobId}`, { method: 'DELETE', headers: { authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
    setJob({ ...job, status: 'canceled' });
    onToast('Cancellation requested');
  };

  const progress = job ? Math.round((job.framesRendered / Math.max(1, job.totalFrames)) * 100) : 0;

  return (
    <div className="panel-content video-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-title-icon video-title-icon"><Film size={16} /></span>
          <div><h2>Video studio</h2><span>Preview here, render on the server</span></div>
        </div>
      </div>

      <div className="video-intro">
        <Clapperboard size={20} />
        <div><strong>The whole composition is recorded</strong><span>Server renders capture the map, charts, titles and source together — not just the map canvas.</span></div>
      </div>

      <div className="video-section">
        <div className="section-title"><span>Timeline</span><span className="video-frame-count">{formatTime(previewFrame / spec.fps)} / {formatTime(spec.durationSeconds)}</span></div>
        <input className="video-timeline" type="range" min="0" max={Math.max(0, total - 1)} value={Math.min(previewFrame, total - 1)} onChange={(event) => { setPlaying(false); onPreviewFrame(Number(event.target.value)); }} aria-label="Video timeline" />
        <div className="video-keyframes"><span>{state.phase}</span><span>{state.year ?? 'no year column'}</span><span>frame {previewFrame + 1}/{total}</span></div>
      </div>

      <div className="video-control-row">
        <button className="small-button" onClick={() => { setPlaying(false); onPreviewFrame(0); }} aria-label="Go to the beginning"><SkipBack size={15} /></button>
        <button className="video-play-button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />}<span>{playing ? 'Pause preview' : 'Play preview'}</span></button>
        <button className="small-button" onClick={() => { setPlaying(false); onPreviewFrame(Math.min(total - 1, previewFrame + Math.round(spec.fps / 2))); }} aria-label="Step forward"><StepForward size={15} /></button>
      </div>

      <div className="video-section video-options">
        <div className="section-title"><span>Animation</span></div>
        <label className="select-row"><span>Mode</span>
          <select value={spec.mode} onChange={(event) => onSpec({ mode: event.target.value as VideoSpec['mode'] })}>
            <option value="year-choropleth">Year-by-year choropleth</option>
            <option value="bar-race">Ranked bar-chart race</option>
            <option value="camera-tour">Animated map camera</option>
            <option value="counter">Animated counter</option>
          </select>
        </label>
        {(spec.mode === 'year-choropleth' || spec.mode === 'bar-race') && years.length === 0 && (
          <p className="panel-hint">This mode animates the Year column. Your data has no Year column yet, so the frame will hold still.</p>
        )}
        {spec.mode === 'bar-race' && (
          <label className="range-row"><span>Bars tracked</span><output>{spec.raceSize}</output>
            <input type="range" min="3" max="20" value={spec.raceSize} onChange={(event) => onSpec({ raceSize: Number(event.target.value) })} />
          </label>
        )}
        <label className="select-row"><span>Transition</span>
          <select value={spec.transition} onChange={(event) => onSpec({ transition: event.target.value as VideoSpec['transition'] })}>
            <option value="fade">Fade in and out</option><option value="wipe">Wipe</option><option value="none">None</option>
          </select>
        </label>
      </div>

      <div className="video-section video-options">
        <div className="section-title"><span>Output</span><span className="video-frame-count">≈ {estimatedFileSizeMb(spec)} MB</span></div>
        <label className="select-row"><span>Resolution</span>
          <select value={spec.preset} onChange={(event) => onSpec({ preset: event.target.value as VideoSpec['preset'] })}>
            {Object.entries(VIDEO_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
          </select>
        </label>
        <label className="select-row"><span>Format</span>
          <select value={spec.format} onChange={(event) => onSpec({ format: event.target.value as VideoSpec['format'] })}>
            {Object.entries(VIDEO_FORMATS).map(([id, format]) => <option key={id} value={id}>{format.label}</option>)}
          </select>
        </label>
        <label className="range-row"><span>Duration</span><output>{spec.durationSeconds}s</output>
          <input type="range" min="3" max="60" value={spec.durationSeconds} onChange={(event) => onSpec({ durationSeconds: Number(event.target.value) })} />
        </label>
        <label className="select-row"><span>Frame rate</span>
          <select value={spec.fps} onChange={(event) => onSpec({ fps: Number(event.target.value) })}>
            <option value={12}>12 fps</option><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option>
          </select>
        </label>
        <div className="toggle-row">
          <label><input type="checkbox" checked={spec.showTitle} onChange={(event) => onSpec({ showTitle: event.target.checked })} /> Title card</label>
          <label><input type="checkbox" checked={spec.showSource} onChange={(event) => onSpec({ showSource: event.target.checked })} /> Source</label>
          <label><input type="checkbox" checked={spec.loop} onChange={(event) => onSpec({ loop: event.target.checked })} /> Loop</label>
        </div>
        <p className="panel-hint">{dimensions.width}×{dimensions.height} · {total} frames</p>
      </div>

      <div className="video-section video-options">
        <div className="section-title"><span><Server size={13} /> Render service</span></div>
        <label className="production-field"><span>API URL</span><input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} /></label>
        <label className="production-field"><span>API key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Never stored by the editor" /></label>
      </div>

      <button className="primary-button wide video-record-button" onClick={() => void submit()} disabled={submitting || !rows.length}>
        <Film size={15} /> {submitting ? 'Submitting…' : `Render ${spec.format.toUpperCase()} on the server`}
      </button>
      {!rows.length && <p className="panel-hint">Connect a dataset before rendering a video.</p>}
      {error && <div className="production-error" role="alert">{error}</div>}

      {job && (
        <div className="production-status">
          <div className="production-status-head"><span>{job.status}</span><button onClick={() => void pollJob(job.jobId)} aria-label="Refresh job status"><RotateCcw size={13} /></button></div>
          <div className="production-progress"><i style={{ width: `${progress}%` }} /></div>
          <div className="production-stats"><span><b>{progress}%</b></span><span><b>{job.framesRendered}</b>/{job.totalFrames} frames</span></div>
          <code>{job.jobId}</code>
          {job.downloadUrl && <a className="primary-button wide" href={job.downloadUrl} download><Download size={14} /> Download {spec.format.toUpperCase()}</a>}
          {['queued', 'rendering', 'encoding'].includes(job.status) && <button className="outline-button wide" onClick={() => void cancel()}><X size={14} /> Cancel render</button>}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
