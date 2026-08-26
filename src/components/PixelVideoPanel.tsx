import { useEffect, useRef, useState } from 'react';
import { Download, Film, Pause, Play, RotateCcw, SkipBack, StepForward, Video, WandSparkles } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { formatDataValue, type DataRow, type InfographicConfig } from '../domain/infographic';
import type { ViewMode } from '../domain/types';

type Props = {
  map: MapLibreMap | null;
  viewMode: ViewMode;
  active: boolean;
  years?: string[];
  currentYear?: string;
  title?: string;
  source?: string;
  rows?: DataRow[];
  config?: InfographicConfig;
  onYearChange?: (year?: string) => void;
  onActiveChange: (active: boolean) => void;
  onToast: (message: string) => void;
};

type CameraKeyframe = { center: [number, number]; zoom: number; bearing: number };
type RecordingSession = { recorder: MediaRecorder; animationFrame: number; stream: MediaStream };

const INDIA_STORYBOARD: CameraKeyframe[] = [
  { center: [78.96, 22.6], zoom: 4.55, bearing: 0 },
  { center: [77.21, 28.61], zoom: 5.65, bearing: -1.5 },
  { center: [72.88, 19.08], zoom: 5.85, bearing: 1.5 },
  { center: [80.27, 13.08], zoom: 5.75, bearing: 0 },
  { center: [78.96, 22.6], zoom: 4.55, bearing: 0 },
];

export function PixelVideoPanel({ map, viewMode, active, years = [], currentYear, title = 'Map data story', source = '', rows = [], config, onYearChange, onActiveChange, onToast }: Props) {
  const [duration, setDuration] = useState(8);
  const [fps, setFps] = useState(12);
  const [pixelSize, setPixelSize] = useState(4);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [videoMode, setVideoMode] = useState<'data' | 'pixel'>(rows.length ? 'data' : 'pixel');
  const recordingRef = useRef<RecordingSession | null>(null);
  const frameRef = useRef(0);
  const lastYearRef = useRef<string | undefined>(currentYear);
  const baseCameraRef = useRef<CameraKeyframe | null>(null);
  const totalFrames = duration * fps;

  const applyFrame = (frame: number) => {
    if (!map) return;
    const progress = totalFrames === 0 ? 0 : Math.min(frame / totalFrames, 1);
    const camera = viewMode === 'india' ? cameraAt(progress) : genericCameraAt(progress, baseCameraRef.current ?? cameraFromMap(map));
    map.jumpTo(camera);
    if (years.length && onYearChange) {
      const year = years[Math.min(years.length - 1, Math.floor(progress * years.length))];
      if (year !== lastYearRef.current) {
        lastYearRef.current = year;
        onYearChange(year);
      }
    }
  };

  const setFrame = (frame: number) => {
    const nextFrame = Math.max(0, Math.min(Math.round(frame), totalFrames));
    frameRef.current = nextFrame;
    setCurrentFrame(nextFrame);
    applyFrame(nextFrame);
  };

  useEffect(() => {
    if (active && map) {
      baseCameraRef.current = cameraFromMap(map);
      setFrame(0);
    }
  }, [active, map, viewMode]);

  useEffect(() => {
    if (!isPlaying || !map || isRecording) return undefined;
    let animationFrame = 0;
    let lastTime = performance.now();
    const frameDuration = 1000 / fps;
    const tick = (time: number) => {
      if (time - lastTime >= frameDuration) {
        const nextFrame = Math.min(frameRef.current + 1, totalFrames);
        setFrame(nextFrame);
        lastTime = time;
        if (nextFrame >= totalFrames) { setIsPlaying(false); return; }
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [fps, isPlaying, isRecording, map, totalFrames, viewMode, years]);

  useEffect(() => () => stopRecording(), []);

  const togglePlayback = () => {
    if (!map) { onToast('The map is still loading'); return; }
    onActiveChange(true);
    if (frameRef.current >= totalFrames) setFrame(0);
    setIsPlaying((playing) => !playing);
  };

  const startRecording = () => {
    if (!map) { onToast('The map is still loading'); return; }
    const sourceCanvas = map.getCanvas();
    if (!sourceCanvas.captureStream || typeof MediaRecorder === 'undefined') { onToast('Video recording is not supported in this browser'); return; }
    const outputCanvas = document.createElement('canvas');
    const scratchCanvas = document.createElement('canvas');
    outputCanvas.width = sourceCanvas.width;
    outputCanvas.height = sourceCanvas.height;
    scratchCanvas.width = Math.max(1, Math.floor(sourceCanvas.width / pixelSize));
    scratchCanvas.height = Math.max(1, Math.floor(sourceCanvas.height / pixelSize));
    const outputContext = outputCanvas.getContext('2d');
    const scratchContext = scratchCanvas.getContext('2d');
    if (!outputContext || !scratchContext) { onToast('Could not create the pixel video surface'); return; }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    const stream = outputCanvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];
    const startedAt = performance.now();
    setIsPlaying(false);
    setIsRecording(true);
    onActiveChange(true);
    baseCameraRef.current = cameraFromMap(map);
    setFrame(0);
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType ?? 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${viewMode}-data-story-${duration}s.webm`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      stream.getTracks().forEach((track) => track.stop());
      recordingRef.current = null;
      setIsRecording(false);
      onToast('Animated data story downloaded as WebM');
    };
    recorder.start(100);
    const draw = (time: number) => {
      if (!recordingRef.current) return;
      const elapsed = time - startedAt;
      const frame = Math.min(Math.floor((elapsed / (duration * 1000)) * totalFrames), totalFrames);
      setFrame(frame);
      scratchContext.imageSmoothingEnabled = false;
      scratchContext.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
      scratchContext.drawImage(sourceCanvas, 0, 0, scratchCanvas.width, scratchCanvas.height);
      outputContext.imageSmoothingEnabled = false;
      outputContext.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      outputContext.drawImage(scratchCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      if (videoMode === 'data') drawDataVideoPanel(outputContext, outputCanvas.width, outputCanvas.height, title, rows, lastYearRef.current, config);
      drawVideoCaption(outputContext, outputCanvas.width, outputCanvas.height, title, lastYearRef.current, source);
      if (frame >= totalFrames) { recorder.stop(); return; }
      recordingRef.current.animationFrame = window.requestAnimationFrame(draw);
    };
    recordingRef.current = { recorder, animationFrame: window.requestAnimationFrame(draw), stream };
  };

  const stopRecording = () => {
    const session = recordingRef.current;
    if (!session) return;
    window.cancelAnimationFrame(session.animationFrame);
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  };

  const keyframeLabels = years.length > 1 ? [years[0], years[Math.floor((years.length - 1) / 2)], years.at(-1)] : ['Reveal', 'Explore', 'Highlight', 'Loop'];
  return <div className="panel-content video-panel"><div className="panel-heading"><div className="panel-title"><span className="panel-title-icon video-title-icon"><Film size={16} /></span><div><h2>Pixel video</h2><span>Animated map and data story</span></div></div></div><div className="video-intro"><WandSparkles size={20} /><div><strong>Make the data move</strong><span>Animate the map, reveal ranked values, and export a captioned WebM. Year columns drive the timeline automatically.</span></div></div>{!map && <div className="video-warning"><strong>Map loading</strong><span>Recording becomes available when the map canvas is ready.</span></div>}<label className="video-toggle"><span><strong>Pixel treatment</strong><small>Nearest-neighbour recording effect</small></span><input type="checkbox" checked={active} onChange={(event) => onActiveChange(event.target.checked)} /></label><div className="video-section video-options"><div className="section-title"><span>Video type</span><span className="video-frame-count">{rows.length ? `${rows.length} data rows` : 'Map only'}</span></div><label className="select-row"><span>Story mode</span><select value={videoMode} onChange={(event) => { setVideoMode(event.target.value as 'data' | 'pixel'); setFrame(0); }}><option value="data">Data story · ranked bars</option><option value="pixel">Pixel map · camera only</option></select></label></div><div className="video-section"><div className="section-title"><span>{years.length > 1 ? 'Time-series timeline' : 'Camera storyboard'}</span><span className="video-frame-count">{formatTime(currentFrame / fps)} / {duration}s</span></div><input className="video-timeline" type="range" min="0" max={totalFrames} value={currentFrame} onChange={(event) => setFrame(Number(event.target.value))} aria-label="Video timeline" /><div className="video-keyframes">{keyframeLabels.map((label) => <span key={label}>{label}</span>)}</div></div><div className="video-control-row"><button className="small-button" onClick={() => setFrame(0)} aria-label="Go to beginning"><SkipBack size={15} /></button><button className="video-play-button" onClick={togglePlayback} disabled={!map || isRecording}>{isPlaying ? <Pause size={15} /> : <Play size={15} />}<span>{isPlaying ? 'Pause preview' : 'Preview animation'}</span></button><button className="small-button" onClick={() => setFrame(currentFrame + Math.max(1, Math.round(fps / 2)))} aria-label="Step forward"><StepForward size={15} /></button></div><div className="video-section video-options"><div className="section-title"><span>Output settings</span></div><label className="select-row"><span>Duration</span><select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setFrame(0); }}><option value={4}>4 seconds</option><option value={8}>8 seconds</option><option value={12}>12 seconds</option></select></label><label className="select-row"><span>Frame rate</span><select value={fps} onChange={(event) => { setFps(Number(event.target.value)); setFrame(0); }}><option value={12}>12 fps · pixel</option><option value={18}>18 fps · smooth</option><option value={24}>24 fps · clean</option></select></label><label className="range-row"><span>Pixel size</span><output>{pixelSize}px</output><input type="range" min="2" max="8" step="1" value={pixelSize} onChange={(event) => setPixelSize(Number(event.target.value))} /></label></div><button className="primary-button wide video-record-button" onClick={isRecording ? stopRecording : startRecording} disabled={!map}>{isRecording ? <><Pause size={15} /> Stop recording</> : <><Video size={15} /> Record data video</>}</button><button className="outline-button wide" onClick={() => { setFrame(0); onActiveChange(false); onToast('Pixel storyboard reset'); }}><RotateCcw size={15} /> Reset storyboard</button><p className="panel-note"><Download size={14} /> Data story mode burns the ranked bars into each video frame, so the downloaded WebM is self-contained.</p></div>;
}

function cameraFromMap(map: MapLibreMap): CameraKeyframe {
  const center = map.getCenter();
  return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing() };
}

function genericCameraAt(progress: number, base: CameraKeyframe) {
  const pulse = Math.sin(progress * Math.PI);
  return { center: base.center, zoom: base.zoom + pulse * 0.72, bearing: base.bearing + Math.sin(progress * Math.PI * 2) * 1.2 };
}

function cameraAt(progress: number) {
  const scaled = progress * (INDIA_STORYBOARD.length - 1);
  const index = Math.min(Math.floor(scaled), INDIA_STORYBOARD.length - 2);
  const localProgress = scaled - index;
  const start = INDIA_STORYBOARD[index];
  const end = INDIA_STORYBOARD[index + 1];
  return { center: [lerp(start.center[0], end.center[0], localProgress), lerp(start.center[1], end.center[1], localProgress)] as [number, number], zoom: lerp(start.zoom, end.zoom, localProgress), bearing: lerp(start.bearing, end.bearing, localProgress) };
}

function drawVideoCaption(context: CanvasRenderingContext2D, width: number, height: number, title: string, year?: string, source?: string) {
  const padding = Math.max(24, width * .035);
  context.fillStyle = 'rgba(255,255,255,.92)';
  context.fillRect(padding, padding, Math.min(width - padding * 2, 560), year ? 94 : 68);
  context.fillStyle = '#172238';
  context.font = `700 ${Math.max(18, width * .027)}px Inter, Arial`;
  context.fillText(title.slice(0, 48), padding + 18, padding + 34);
  if (year) { context.fillStyle = '#5b6b82'; context.font = `600 ${Math.max(14, width * .018)}px Inter, Arial`; context.fillText(year, padding + 18, padding + 65); }
  if (source) { context.fillStyle = 'rgba(255,255,255,.9)'; context.fillRect(padding, height - padding - 34, Math.min(width - padding * 2, 680), 28); context.fillStyle = '#66748a'; context.font = `500 ${Math.max(10, width * .011)}px Inter, Arial`; context.fillText(source.slice(0, 100), padding + 10, height - padding - 15); }
}

function drawDataVideoPanel(context: CanvasRenderingContext2D, width: number, height: number, title: string, rows: DataRow[], year: string | undefined, config?: InfographicConfig) {
  const visible = rows.filter((row) => !year || !row.year || row.year === year)
    .map((row) => ({ region: row.region, value: typeof row.value === 'number' ? row.value : Number(String(row.value).replace(/[₹$€£,%\s,()]/g, '')) }))
    .filter((row) => Number.isFinite(row.value))
    .sort((first, second) => second.value - first.value)
    .slice(0, 5);
  if (!visible.length) return;
  const panelWidth = Math.min(width * .41, 360);
  const left = width - panelWidth - Math.max(20, width * .035);
  const top = Math.max(20, height * .075);
  const panelHeight = Math.min(height * .62, 330);
  context.fillStyle = 'rgba(255,255,255,.94)';
  context.fillRect(left, top, panelWidth, panelHeight);
  context.fillStyle = '#172238';
  context.font = `700 ${Math.max(15, width * .022)}px Inter, Arial`;
  context.fillText('Top regions', left + 18, top + 30);
  if (year) { context.fillStyle = '#66748a'; context.font = `600 ${Math.max(11, width * .014)}px Inter, Arial`; context.fillText(year, left + panelWidth - 46, top + 30); }
  const maxValue = visible[0].value || 1;
  visible.forEach((row, index) => {
    const rowTop = top + 58 + index * Math.min(48, panelHeight / 6);
    context.fillStyle = '#66748a';
    context.font = `600 ${Math.max(10, width * .012)}px Inter, Arial`;
    context.fillText(`${index + 1}`, left + 18, rowTop);
    context.fillStyle = '#172238';
    context.font = `600 ${Math.max(11, width * .014)}px Inter, Arial`;
    context.fillText(row.region.slice(0, 20), left + 38, rowTop);
    const formatted = config ? formatDataValue(row.value, config) : row.value.toLocaleString('en-IN');
    context.fillStyle = '#176da4';
    context.font = `700 ${Math.max(11, width * .014)}px Inter, Arial`;
    context.textAlign = 'right';
    context.fillText(formatted, left + panelWidth - 18, rowTop);
    context.textAlign = 'left';
    context.fillStyle = '#dceaf3';
    context.fillRect(left + 38, rowTop + 9, panelWidth - 56, 6);
    context.fillStyle = '#2f83b5';
    context.fillRect(left + 38, rowTop + 9, Math.max(5, ((row.value / maxValue) * (panelWidth - 56))), 6);
  });
  context.fillStyle = '#66748a';
  context.font = `500 ${Math.max(9, width * .01)}px Inter, Arial`;
  context.fillText(title.slice(0, 42), left + 18, top + panelHeight - 17);
}

function lerp(start: number, end: number, progress: number) { return start + (end - start) * progress; }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
