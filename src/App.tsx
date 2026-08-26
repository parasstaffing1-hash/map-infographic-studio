import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BarChart3, Bookmark, Check, ChevronDown, CircleHelp, Command, Database, Download, Eye, EyeOff, Factory, FileImage, Filter, FolderOpen, Landmark, Layers3, LayoutTemplate, Map as MapIcon, MapPinned, Palette, Redo2, Save, Search, Settings2, Share2, SlidersHorizontal, Sparkles, Type, Undo2, Users, Video, X } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AnnotationLayer } from './components/AnnotationLayer';
import { CompositionCanvas } from './components/CompositionCanvas';
import { MapOverlays } from './components/MapOverlays';
import { InfographicEditorPanel } from './components/InfographicEditorPanel';
import { MapCanvas } from './components/MapCanvas';
import { ProductionPanel } from './components/ProductionPanel';
import { StatistaStoryOverlay } from './components/StatistaStoryOverlay';
import { sourceCatalog } from './domain/data';
import { compositionById, compositionHasMap, DEFAULT_COMPOSITION_ID } from './domain/composition';
import { applyRegionOverrides, attributionLine } from './domain/dataSources';
import { createVisualization, dataYears, type Annotation, type DataRow, type InfographicConfig } from './domain/infographic';
import { can, readSharedProjectFromLocation, toProjectDocument, type ProjectRole } from './domain/projects';
import type { ServerProject } from './domain/apiClient';
import { migrateProjectDocument, type BrandKitSnapshot } from './domain/projectDocument';
import { DEFAULT_VIDEO_SPEC, frameState, totalFrames, type VideoSpec } from './domain/videoTimeline';
import { useStudioProject } from './store/useStudioProject';
import { configForInfographicTemplate, infographicCategories, infographicTemplates, rowsForInfographicTemplate, searchInfographicTemplates, testGeneralInfographicTemplates, testMapInfographicTemplates, testVideoTemplates, type InfographicCategory, type InfographicTemplate } from './domain/infographicTemplates';
import { parseMapRequest } from './domain/parser';
import { countryTemplates, districtTemplates, templateForScope, type DistrictTemplate } from './domain/templates';
import type { EditorCommand, FilterSpec, GeoFeature, ResolvedEntity, ViewMode } from './domain/types';
import { useMapStudio } from './store/useMapStudio';

const DataConnectionsPanel = lazy(() => import('./components/DataConnectionsPanel').then((module) => ({ default: module.DataConnectionsPanel })));
const ExportStudioPanel = lazy(() => import('./components/ExportStudioPanel').then((module) => ({ default: module.ExportStudioPanel })));
const VideoStudioPanel = lazy(() => import('./components/VideoStudioPanel').then((module) => ({ default: module.VideoStudioPanel })));
const ChartStudioPanel = lazy(() => import('./components/ChartStudioPanel').then((module) => ({ default: module.ChartStudioPanel })));
const ProjectsPanel = lazy(() => import('./components/ProjectsPanel').then((module) => ({ default: module.ProjectsPanel })));
const AccountPanel = lazy(() => import('./components/AccountPanel').then((module) => ({ default: module.AccountPanel })));

const suggestions = [
  'Make a map of India',
  'Make a map of USA',
  'Make a map of China',
  'Create an India pixel map video',
  'Show Jammu and Kashmir districts',
  'Show Uttarakhand districts',
  'Show Uttarakhand Assembly constituencies',
  'Make a map of the top 100 cities in India',
  'Show world countries',
  'Make a map of Bangladesh',
  'Make a map of NYC',
  'Make a map of Kandy',
  'Make me a map of Ramnagar, Uttarakhand',
  'Highlight constituencies with margin under 5%',
];

const INDIA_LEVELS: ViewMode[] = ['india-districts', 'india-assembly', 'india-parliament'];
const USA_LEVELS: ViewMode[] = ['usa-counties', 'usa-state-house', 'usa-congress'];
const CHINA_LEVELS: ViewMode[] = ['china-prefectures', 'china-counties', 'china-npc'];
/** Longest a single video frame may wait for the map before it is captured anyway. */
const VIDEO_FRAME_SETTLE_MS = 1_200;

/** Where a server renderer seeds the versioned project document. */
const RENDER_DOCUMENT_KEY = 'map-studio-render-document';

/**
 * True when the page was opened by a renderer. Read once, synchronously, so the
 * very first render already knows: the seeded document is then the only source
 * of truth and the ordinary project hydrate/persist effects must stay out of it.
 */
const IS_RENDER_MODE = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('render') === '1';

const PRODUCTION_VIEW_MODES: ViewMode[] = ['world', 'india', 'usa', 'china', ...INDIA_LEVELS, ...USA_LEVELS, ...CHINA_LEVELS];

type StoredProject = { rows?: DataRow[]; config?: Partial<InfographicConfig>; annotations?: Annotation[]; currentYear?: string };

function readStoredProject(): StoredProject | null {
  try {
    return JSON.parse(localStorage.getItem('map-studio-infographic-v1') ?? 'null') as StoredProject | null;
  } catch {
    return null;
  }
}

function titleForView(viewMode: ViewMode, scopeLabel?: string, requestPlace?: string) {
  if (viewMode === 'world') return 'World countries';
  if (viewMode === 'india') return 'India interactive map';
  if (viewMode === 'usa') return 'USA interactive map';
  if (viewMode === 'china') return 'China interactive map';
  if (viewMode === 'india-districts') return `${scopeLabel ?? 'India'} district map`;
  if (viewMode === 'india-assembly') return `${scopeLabel ?? 'India'} MLA seat map`;
  if (viewMode === 'india-parliament') return `${scopeLabel ?? 'India'} MP seat map`;
  if (viewMode === 'usa-counties') return `${scopeLabel ?? 'USA'} county map`;
  if (viewMode === 'usa-state-house') return `${scopeLabel ?? 'USA'} State House map`;
  if (viewMode === 'usa-congress') return `${scopeLabel ?? 'USA'} Congressional map`;
  if (viewMode === 'china-prefectures') return `${scopeLabel ?? 'China'} prefecture map`;
  if (viewMode === 'china-counties') return `${scopeLabel ?? 'China'} local congress context`;
  if (viewMode === 'china-npc') return `${scopeLabel ?? 'China'} NPC electoral-unit context`;
  if (viewMode === 'delhi-assembly') return 'Delhi MLA seat map';
  if (viewMode === 'jammu-kashmir') return 'Jammu and Kashmir + Ladakh map';
  if (viewMode === 'place') return requestPlace ?? 'Place result';
  if (viewMode === 'cities') return 'Top 100 cities';
  if (viewMode === 'assembly') return 'Assembly constituencies';
  return viewMode === 'district' ? 'Districts' : 'State overview';
}

function scaleLabelForView(viewMode: ViewMode, count: number, scopeLabel?: string) {
  if (viewMode === 'place') return 'Place context';
  if (viewMode === 'india') return `${count} clickable states and UTs`;
  if (viewMode === 'usa') return `${count} clickable states and DC`;
  if (viewMode === 'china') return `${count} clickable province-level units`;
  if (viewMode === 'india-districts') return `${count} ${scopeLabel ?? 'India'} districts`;
  if (viewMode === 'india-assembly') return `${count} ${scopeLabel ?? 'India'} MLA seats`;
  if (viewMode === 'india-parliament') return `${count} ${scopeLabel ?? 'India'} MP seats`;
  if (viewMode === 'usa-counties') return `${count} ${scopeLabel ?? 'USA'} counties`;
  if (viewMode === 'usa-state-house') return `${count} ${scopeLabel ?? 'USA'} State House districts`;
  if (viewMode === 'usa-congress') return `${count} ${scopeLabel ?? 'USA'} Congressional districts`;
  if (viewMode === 'china-prefectures') return `${count} ${scopeLabel ?? 'China'} prefectures`;
  if (viewMode === 'china-counties') return `${count} ${scopeLabel ?? 'China'} county-level units`;
  if (viewMode === 'china-npc') return `${count} ${scopeLabel ?? 'China'} NPC geographic units`;
  if (viewMode === 'delhi-assembly') return `${count} Delhi MLA seats`;
  if (viewMode === 'jammu-kashmir') return `${count} J&K districts`;
  return `${count} mapped entities`;
}

function legendLabelForView(viewMode: ViewMode, fallback: string) {
  if (viewMode === 'india-assembly') return 'MLA constituency';
  if (viewMode === 'india-parliament') return 'MP constituency';
  if (viewMode === 'usa-counties') return 'County or county equivalent';
  if (viewMode === 'usa-state-house') return 'Lower-chamber legislative district';
  if (viewMode === 'usa-congress') return 'Congressional district';
  if (viewMode === 'china-prefectures') return 'Prefecture-level unit';
  if (viewMode === 'china-counties') return 'County-level administrative unit';
  if (viewMode === 'china-npc') return 'Province-level NPC context unit';
  return viewMode === 'assembly' || viewMode === 'delhi-assembly' ? 'Assembly boundary' : fallback;
}

function sourceLabelForView(viewMode: ViewMode, districtScope?: string, focusPlace?: string) {
  if (viewMode === 'world') return 'Natural Earth · low-resolution context';
  if (viewMode === 'india') return 'Official national outline · click a state or UT to drill down';
  if (viewMode === 'usa' || viewMode === 'usa-counties') return 'U.S. Census Bureau · official 2024 cartographic boundaries';
  if (viewMode === 'usa-state-house') return 'U.S. Census Bureau · official 2024 lower-chamber district plans';
  if (viewMode === 'usa-congress') return 'U.S. Census Bureau · official 119th Congressional Districts (2025–2027)';
  if (viewMode === 'china' || viewMode === 'china-prefectures') return 'GADM administrative geometry · clipped against the official India outline';
  if (viewMode === 'china-counties') return 'GADM county units · local congress context, not electoral-district polygons';
  if (viewMode === 'china-npc') return 'NPC constitutional structure · province geometry only, not constituency polygons';
  if (viewMode === 'india-districts' && districtScope === 'NCTofDelhi') return 'NWIC / GSI · May 2025 published Delhi district geometry';
  if (viewMode === 'india-districts') return 'GADM India district geometry · state-scoped drill-down';
  if (viewMode === 'india-assembly') return 'DataMeet India Assembly boundaries · CC BY 4.0';
  if (viewMode === 'india-parliament') return 'DataMeet 2019 parliamentary boundaries · CC BY 4.0';
  if (viewMode === 'delhi-assembly') return 'DataMeet geometry · CEO Delhi 70-seat reference';
  if (viewMode === 'jammu-kashmir') return 'Separate J&K and Ladakh UT boundaries · official-style colors';
  if (viewMode === 'place' && focusPlace?.toLowerCase() === 'india') return 'Official India outline · local boundary source';
  if (viewMode === 'place') return 'OSM Nominatim · place context';
  if (viewMode === 'cities') return 'Census 2011-derived fixture';
  return viewMode === 'assembly' ? 'DataMeet · CC BY 4.0' : 'GADM · context-only';
}

export default function App() {
  const {
    request, commandText, viewMode, editorMode, selectedIds, hiddenLayers, style, filters, saveState,
    setCommandText, runCommand, setViewMode, setEditorMode, toggleLayer, setSelection, setStyle, removeFilter, undo, redo, markSaved, hydrate,
  } = useMapStudio();
  const sharedPayload = useMemo(() => readSharedProjectFromLocation(window.location.search, window.location.hash), []);
  const role: ProjectRole = sharedPayload ? 'viewer' : 'owner';
  const studio = useStudioProject(role);
  const project = studio.project;
  const [selectedEntity, setSelectedEntity] = useState<ResolvedEntity | null>(null);
  const [focusPlace, setFocusPlace] = useState<string | undefined>(request.viewport.fitEntity);
  const [activeNav, setActiveNav] = useState<'search' | 'layers' | 'data' | 'charts' | 'infographics' | 'templates' | 'filters' | 'projects' | 'saved' | 'video' | 'export' | 'production'>('layers');
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [pixelVideoActive, setPixelVideoActive] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [featureCount, setFeatureCount] = useState(1);
  const [notice, setNotice] = useState('');
  const [districtScope, setDistrictScope] = useState<string | undefined>();
  const [activeFeatures, setActiveFeatures] = useState<GeoFeature[]>([]);
  const [activeFeatureViewMode, setActiveFeatureViewMode] = useState<ViewMode>();
  const [activeInfographicId, setActiveInfographicId] = useState<string>();
  const [videoSpec, setVideoSpec] = useState<VideoSpec>(DEFAULT_VIDEO_SPEC);
  const [previewFrame, setPreviewFrame] = useState(0);
  // Bumped on every setFrame call so re-requesting the current frame still settles.
  const [frameTick, setFrameTick] = useState(0);
  const [isVideoRenderMode, setIsVideoRenderMode] = useState(false);
  const [brandKitSnapshot, setBrandKitSnapshot] = useState<BrandKitSnapshot | undefined>();
  // Below the mobile breakpoint the side panels become bottom sheets that are
  // closed until a rail button or the Design toggle opens one.
  const [mobileDrawer, setMobileDrawer] = useState<'left' | 'right' | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // A shared link opens the project read-only; nothing is written back to storage.
  const dataRows = sharedPayload?.rows ?? project.rows;
  const infographicConfig = sharedPayload?.config ?? project.config;
  const annotations = sharedPayload?.annotations ?? project.annotations;
  const currentYear = sharedPayload?.currentYear ?? project.currentYear;
  const compositionId = sharedPayload?.compositionId ?? project.compositionId ?? DEFAULT_COMPOSITION_ID;
  const chartOverrides = sharedPayload?.chartOverrides ?? project.chartOverrides;
  const datasetMeta = sharedPayload?.datasetMeta ?? project.datasetMeta;
  const composition = compositionById(compositionId);
  // In render mode the brand kit arrives embedded in the document; in the editor
  // it comes from the workspace kit the project points at.
  const activeBrandKit = studio.brandKits.find((kit) => kit.id === project.brandKitId);
  const activeLogoDataUrl = brandKitSnapshot?.logoDataUrl ?? activeBrandKit?.logoDataUrl;
  const activeBrandKitName = brandKitSnapshot?.name ?? activeBrandKit?.name ?? 'Brand';

  // One versioned document, shared by the editor, the exporter and both renderers.
  const renderDocument = useMemo(
    () => ({ ...toProjectDocument(project, studio.brandKits), videoSpec }),
    [project, studio.brandKits, videoSpec],
  );
  const setDataRows = studio.setRows;
  const setAnnotations = studio.setAnnotations;
  const setCurrentYear = useCallback((year?: string) => studio.patch({ currentYear: year }), [studio]);
  const setInfographicConfig = studio.patchConfig;

  const districtTemplate = templateForScope(districtScope);
  const districtLabel = districtTemplate?.label ?? (districtScope ? focusPlace : undefined);
  const isIndiaLevel = INDIA_LEVELS.includes(viewMode);
  const isUsaLevel = USA_LEVELS.includes(viewMode);
  const isChinaLevel = CHINA_LEVELS.includes(viewMode);
  const isPoliticalLevel = viewMode === 'india-assembly' || viewMode === 'india-parliament' || viewMode === 'usa-state-house' || viewMode === 'usa-congress' || viewMode === 'china-counties' || viewMode === 'china-npc' || viewMode === 'assembly' || viewMode === 'delhi-assembly';
  const currentTitle = titleForView(viewMode, districtLabel, request.place);
  const activeInfographic = infographicTemplates.find((template) => template.id === activeInfographicId);
  const canvasTitle = activeInfographic?.title ?? currentTitle;
  const visibleFeatureCount = featureCount;
  const isIndiaScoped = viewMode === 'india' || isIndiaLevel || viewMode === 'delhi-assembly' || viewMode === 'jammu-kashmir' || viewMode === 'state' || viewMode === 'district' || viewMode === 'assembly' || viewMode === 'cities' || request.place === 'Uttarakhand' || request.place === 'India' || request.place === 'Jammu and Kashmir';
  const rootGeography = viewMode === 'world' ? 'World' : viewMode === 'usa' || isUsaLevel ? 'USA' : viewMode === 'china' || isChinaLevel ? 'China' : request.parentGeography ?? (isIndiaScoped ? 'India' : 'Global');
  const countryWorkspace = viewMode === 'india' || isIndiaLevel ? 'India' : viewMode === 'usa' || isUsaLevel ? 'USA' : viewMode === 'china' || isChinaLevel ? 'China' : undefined;
  const displayGeography = districtScope ? districtLabel ?? 'Selected region' : countryWorkspace ?? request.place ?? rootGeography;
  const requestLabel = isPoliticalLevel || request.mapType === 'political' ? 'Political map' : request.mapType === 'demographic' ? 'Population map' : 'Boundary exploration';
  const years = useMemo(() => dataYears(dataRows), [dataRows]);
  // Manual name corrections are applied before matching so a fixed name colours its region.
  const resolvedRows = useMemo(() => applyRegionOverrides(dataRows, project.regionOverrides ?? {}), [dataRows, project.regionOverrides]);
  const videoFrame = useMemo(() => frameState(videoSpec, previewFrame, resolvedRows, infographicConfig, years), [infographicConfig, previewFrame, resolvedRows, videoSpec, years]);
  // The timeline only drives the map while the video studio is actually open,
  // so opening a video template does not silently rewind the year on the canvas.
  const isPreviewingVideo = activeNav === 'video' && pixelVideoActive;
  const displayYear = isVideoRenderMode || isPreviewingVideo ? videoFrame.year ?? currentYear : currentYear;
  const visualization = useMemo(() => createVisualization(resolvedRows, activeFeatures, displayYear, infographicConfig), [activeFeatures, displayYear, resolvedRows, infographicConfig]);
  const dataVisuals = dataRows.length ? visualization.byFeatureId : {};
  const isEditorialStory = infographicConfig.presentation === 'editorial';
  const isStatistaStory = infographicConfig.presentation === 'statista';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('render') !== '1') return;
    document.body.classList.add('render-mode');

    // The versioned render document is the contract. When the renderer seeded
    // one, it wins over every URL hint and over anything cached in this browser.
    let seeded = false;
    try {
      const raw = localStorage.getItem(RENDER_DOCUMENT_KEY) ?? localStorage.getItem('map-studio-infographic-v1');
      if (raw) {
        const incoming = migrateProjectDocument(JSON.parse(raw));
        studio.patch({
          name: incoming.name,
          geography: incoming.geography,
          presentation: incoming.presentation,
          compositionId: incoming.compositionId,
          chartOverrides: incoming.chartOverrides,
          config: incoming.config,
          rows: incoming.rows,
          annotations: incoming.annotations,
          currentYear: incoming.currentYear,
          datasetMeta: incoming.datasetMeta,
          regionOverrides: incoming.regionOverrides,
          filters: incoming.filters,
          videoSpec: incoming.videoSpec,
        });
        hydrate({
          viewMode: incoming.geography.viewMode,
          selectedIds: incoming.geography.selectedIds ?? [],
          style: incoming.presentation.style,
          hiddenLayers: incoming.presentation.hiddenLayers,
          filters: incoming.filters,
        });
        setDistrictScope(incoming.geography.districtScope);
        setFocusPlace(incoming.geography.focusPlace);
        setVideoSpec({ ...DEFAULT_VIDEO_SPEC, ...incoming.videoSpec });
        setBrandKitSnapshot(incoming.brandKit);
        hydratedProjectRef.current = 'render';
        seeded = true;
      }
    } catch (error) {
      // A malformed document must not block the render; fall back to URL hints,
      // but say so loudly - a silent fallback hides a broken render contract.
      console.error('[map-studio] could not apply the seeded render document', error);
    }

    if (!seeded) {
      const requestedView = params.get('viewMode') as ViewMode | null;
      if (requestedView && PRODUCTION_VIEW_MODES.includes(requestedView)) setViewMode(requestedView);
      const requestedComposition = params.get('composition');
      if (requestedComposition) studio.patch({ compositionId: requestedComposition });
      const requestedScope = params.get('districtScope');
      if (requestedScope) setDistrictScope(requestedScope);
    }

    if (params.get('mode') === 'video') {
      setIsVideoRenderMode(true);
      if (!seeded) {
        try {
          const stored = JSON.parse(localStorage.getItem('map-studio-video-spec') ?? 'null') as VideoSpec | null;
          if (stored) setVideoSpec({ ...DEFAULT_VIDEO_SPEC, ...stored });
        } catch {
          // A malformed spec falls back to the defaults rather than blocking the render.
        }
      }
    }
    setEditorMode('viewer');
    return () => document.body.classList.remove('render-mode');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEditorMode, setViewMode]);

  useEffect(() => {
    if (currentYear && !years.includes(currentYear)) setCurrentYear(years.at(-1));
  }, [currentYear, years]);

  useEffect(() => {
    if (!activeInfographic?.demoMode || activeFeatureViewMode !== activeInfographic.viewMode || viewMode !== activeInfographic.viewMode || !activeFeatures.length) return;
    const rows = rowsForInfographicTemplate(activeInfographic, activeFeatures);
    if (!rows.length) return;
    setDataRows(rows, { origin: 'template-demo', synthetic: true, rowCount: rows.length });
    const demoYears = dataYears(rows);
    setCurrentYear(demoYears.at(-1));
    setNotice(`${activeInfographic.title} ready · ${rows.length} synthetic demo rows`);
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [activeFeatureViewMode, activeFeatures, activeInfographic, viewMode]);

  // The server video renderer drives frames through this bridge. Keeping it in one
  // place means the browser preview and the server render share the same timeline.
  useEffect(() => {
    if (!isVideoRenderMode) return undefined;
    window.__mapStudioVideo = {
      ready: true,
      totalFrames: totalFrames(videoSpec),
      settled: false,
      // Exposed so a renderer (or an operator) can confirm which spec was applied.
      spec: videoSpec,
      setFrame: (frame: number) => {
        window.__mapStudioVideo!.settled = false;
        setPreviewFrame(Math.max(0, Math.min(frame, totalFrames(videoSpec) - 1)));
        setFrameTick((tick) => tick + 1);
      },
    };
    return () => { delete window.__mapStudioVideo; };
  }, [isVideoRenderMode, videoSpec]);

  // Mark the frame settled once the map has repainted it. The map's 'idle' event
  // settles the frame as soon as it is genuinely ready; the timer is the backstop
  // so a frame can never hang the renderer when no idle event arrives (a
  // composition without a map, or a page that is not compositing).
  useEffect(() => {
    if (!isVideoRenderMode || !window.__mapStudioVideo) return undefined;
    let cancelled = false;
    const settle = () => {
      if (cancelled || !window.__mapStudioVideo) return;
      window.__mapStudioVideo.settled = true;
    };
    const backstop = window.setTimeout(settle, VIDEO_FRAME_SETTLE_MS);
    if (!mapInstance) {
      return () => { cancelled = true; window.clearTimeout(backstop); };
    }
    mapInstance.once('idle', settle);
    return () => {
      cancelled = true;
      window.clearTimeout(backstop);
      mapInstance.off('idle', settle);
    };
  }, [frameTick, isVideoRenderMode, mapInstance, previewFrame, videoFrame.year]);

  // Camera-tour mode moves the map itself, frame by frame.
  useEffect(() => {
    if (!videoFrame.camera || !mapInstance) return;
    mapInstance.jumpTo(videoFrame.camera);
  }, [mapInstance, videoFrame.camera]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        commandInputRef.current?.focus();
        commandInputRef.current?.select();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setActiveNav('export');
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !isInput) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !isInput) {
        event.preventDefault();
        redo();
      } else if (event.key === 'Escape') {
        setMobileDrawer(null);
        setSelectedEntity(null);
        setSelection([]);
        if (isInput) (event.target as HTMLElement).blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, setSelection, setSelectedEntity, undo]);

  // ---- Geography persistence -------------------------------------------------
  // The project is the source of truth across reloads. On open we push its saved
  // geography into the interactive store; afterwards every navigation writes back.
  const hydratedProjectRef = useRef<string | undefined>(undefined);
  const apiClientRef = useRef<ReturnType<typeof import('./domain/apiClient').createApiClient> | null>(null);

  useEffect(() => {
    const source = sharedPayload ?? project;
    const geography = sharedPayload?.geography ?? project?.geography;
    const presentation = sharedPayload?.presentation ?? project?.presentation;
    const key = sharedPayload ? 'shared' : project?.id;
    if (!geography || !key || hydratedProjectRef.current === key) return;
    hydratedProjectRef.current = key;
    hydrate({
      viewMode: geography.viewMode,
      selectedIds: geography.selectedIds ?? [],
      style: { ...style, ...presentation?.style },
      // An empty saved map means the project predates layer capture: keep defaults.
      hiddenLayers: presentation && Object.keys(presentation.hiddenLayers ?? {}).length ? presentation.hiddenLayers : hiddenLayers,
      filters: (source as { filters?: FilterSpec[] }).filters ?? [],
    });
    setDistrictScope(geography.districtScope);
    setFocusPlace(geography.focusPlace);
    if (project.videoSpec) setVideoSpec((current) => ({ ...current, ...project.videoSpec }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, sharedPayload]);

  useEffect(() => {
    if (IS_RENDER_MODE || sharedPayload || hydratedProjectRef.current !== project.id) return;
    studio.setGeography({ viewMode, districtScope, focusPlace, placeContext: request.parentGeography, selectedIds });
  }, [districtScope, focusPlace, project.id, request.parentGeography, selectedIds, sharedPayload, studio, viewMode]);

  useEffect(() => {
    if (IS_RENDER_MODE || sharedPayload || hydratedProjectRef.current !== project.id) return;
    studio.setPresentation({ style, hiddenLayers });
  }, [hiddenLayers, project.id, sharedPayload, studio, style]);

  useEffect(() => {
    if (IS_RENDER_MODE || sharedPayload || hydratedProjectRef.current !== project.id) return;
    studio.setFilters(filters);
  }, [filters, project.id, sharedPayload, studio]);

  useEffect(() => {
    if (IS_RENDER_MODE || sharedPayload || hydratedProjectRef.current !== project.id) return;
    studio.setVideoSpec(videoSpec);
  }, [project.id, sharedPayload, studio, videoSpec]);

  const patchInfographicConfig = useCallback((patch: Partial<InfographicConfig>) => setInfographicConfig(patch), [setInfographicConfig]);
  const restoreProject = useCallback((stored: StoredProject) => {
    if (Array.isArray(stored.rows)) setDataRows(stored.rows);
    if (stored.config) setInfographicConfig(stored.config);
    if (Array.isArray(stored.annotations)) setAnnotations(stored.annotations);
    setCurrentYear(stored.currentYear);
    setNotice('Editable infographic project restored');
  }, [setAnnotations, setCurrentYear, setDataRows, setInfographicConfig]);

  const handleCommand = (value: string) => {
    setActiveInfographicId(undefined);
    setDistrictScope(undefined);
    const parsed = runCommand(value);
    const isVideoRequest = /\b(pixel|video|animate|animation)\b/i.test(value);
    if (isVideoRequest) {
      setActiveNav('video');
      setPixelVideoActive(true);
    }
    if (parsed?.type === 'fit-place') setFocusPlace(parsed.place);
    if (!parsed) {
      const nextRequest = parseMapRequest(value);
      setFocusPlace(nextRequest.viewport.fitEntity);
      setNotice(isVideoRequest ? 'Pixel video studio opened · India storyboard ready' : `Request understood · ${nextRequest.mapType} / ${nextRequest.entityType.replace(/_/g, ' ')}`);
    } else {
      setNotice(commandNotice(parsed));
    }
    window.setTimeout(() => setNotice(''), 2800);
  };

  const handleTemplate = (template: DistrictTemplate) => {
    setActiveInfographicId(undefined);
    runCommand(template.command);
    setDistrictScope(template.scope);
    setViewMode(template.viewMode);
    setEditorMode('editor');
    setActiveNav('layers');
    setSelectedEntity(null);
    setSelection([]);
    setStyle({ opacity: 0.78, lineWidth: 1.8 });
    setNotice(`${template.label} ready for infographic editing`);
    window.setTimeout(() => setNotice(''), 2800);
  };

  const handleInfographicTemplate = (template: InfographicTemplate) => {
    // Real imported data always wins over a template's sample rows, so switching
    // templates restyles the story instead of discarding the user's dataset.
    const userOwnsData = dataRows.length > 0 && !datasetMeta.synthetic && datasetMeta.origin !== 'template-demo';
    const templateRows = userOwnsData ? [] : rowsForInfographicTemplate(template);
    const templateConfig = configForInfographicTemplate(template);
    setActiveInfographicId(template.id);
    setDistrictScope(undefined);
    setFocusPlace(template.geoScope === 'Chile' ? 'Chile' : undefined);
    setViewMode(template.viewMode);
    setEditorMode('editor');
    setSelectedEntity(null);
    setSelection([]);
    // Keep the user's own title, subtitle and source when they have written one.
    setInfographicConfig(userOwnsData
      ? { ...templateConfig, title: infographicConfig.title, subtitle: infographicConfig.subtitle, source: infographicConfig.source, note: infographicConfig.note }
      : templateConfig);
    if (!userOwnsData) {
      setDataRows(templateRows, { origin: 'template-demo', synthetic: Boolean(template.demoMode) || templateRows.length > 0, publisher: template.source ?? '', rowCount: templateRows.length });
      setCurrentYear(templateRows.some((row) => row.year === '2024') ? '2024' : undefined);
      setAnnotations(template.presentation === 'editorial' ? [] : [{
        id: `template-stat-${template.id}`,
        type: 'text',
        text: `${template.statsHook.value} · ${template.statsHook.label}`,
        x: 81,
        y: 16,
        color: template.previewColor,
        size: 12,
      }]);
    }
    setStyle({ fill: template.previewColor, opacity: 0.84, lineWidth: 1.6 });
    setPixelVideoActive(template.openPanel === 'video');
    setActiveNav(template.openPanel);
    setNotice(userOwnsData
      ? `${template.title} styling applied · your ${dataRows.length} rows kept`
      : template.demoMode
        ? `${template.title} · preparing synthetic demo data`
        : templateRows.length
          ? `${template.title} loaded with ${templateRows.length} sample rows`
          : `${template.title} storyboard ready · connect data to publish`);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const handleSelect = useCallback((entity: ResolvedEntity, feature: GeoFeature) => {
    const normalizedName = entity.name.replace(/[\s_-]/g, '').toLowerCase();
    if (viewMode === 'india' && (normalizedName === 'jammuandkashmir' || normalizedName === 'ladakh')) {
      setSelectedEntity(null);
      setSelection([]);
      setDistrictScope(undefined);
      setFocusPlace(entity.name);
      setViewMode('jammu-kashmir');
      setNotice('Opened Jammu and Kashmir + Ladakh district view');
      return;
    }
    if (viewMode === 'india') {
      const scope = String(feature.properties.NAME_1 ?? '');
      if (!scope) return;
      setSelectedEntity(null);
      setSelection([]);
      setDistrictScope(scope);
      setFocusPlace(entity.name === 'NCT of Delhi' ? 'Delhi' : entity.name);
      setViewMode('india-districts');
      setNotice(`${entity.name} opened · district map`);
      return;
    }
    if (viewMode === 'usa') {
      const scope = String(feature.properties.SCOPE_CODE ?? '');
      if (!scope) return;
      setSelectedEntity(null);
      setSelection([]);
      setDistrictScope(scope);
      setFocusPlace(entity.name);
      setViewMode('usa-counties');
      setNotice(`${entity.name} opened · county map`);
      return;
    }
    if (viewMode === 'china') {
      const scope = String(feature.properties.SCOPE_CODE ?? '');
      if (!scope) return;
      setSelectedEntity(null);
      setSelection([]);
      setDistrictScope(scope);
      setFocusPlace(entity.name);
      setViewMode('china-prefectures');
      setNotice(`${entity.name} opened · prefecture map`);
      return;
    }
    setSelectedEntity(entity);
    setSelection([entity.id]);
  }, [setSelection, setViewMode, viewMode]);

  const handleTab = (nextViewMode: ViewMode) => {
    const resolvedViewMode = nextViewMode === 'assembly' ? 'india-assembly' : nextViewMode;
    const keepScope = INDIA_LEVELS.includes(resolvedViewMode) || USA_LEVELS.includes(resolvedViewMode) || CHINA_LEVELS.includes(resolvedViewMode);
    if (!keepScope) setDistrictScope(undefined);
    setViewMode(resolvedViewMode);
    if (resolvedViewMode === 'place') setFocusPlace(request.place ?? request.parentGeography);
    setSelectedEntity(null);
    setSelection([]);
  };

  const filteredSources = useMemo(() => sourceCatalog, []);
  const isComposed = compositionId !== DEFAULT_COMPOSITION_ID;
  const hasMapBlock = compositionHasMap(composition, infographicConfig.aspect);
  // Editor affordances are off in render mode and in the viewer, so clean
  // previews, exports and server-rendered frames all agree.
  const editorChrome = editorMode === 'editor' && !isVideoRenderMode;
  const legendItems = dataRows.length
    ? visualization.legend.map((item) => ({ color: item.color, label: item.label }))
    : [
        { label: 'Selected region', selected: true },
        ...(viewMode === 'jammu-kashmir'
          ? [
              { color: '#f4c542', label: 'Jammu and Kashmir districts' },
              { color: '#7ce8eb', label: 'Ladakh official outline' },
            ]
          : [{ color: style.fill, label: legendLabelForView(viewMode, currentTitle) }]),
      ];

  // Map chrome belongs to the map block, never to the frame: this is what stops
  // the legend and the callout landing on top of a chart in a composed layout.
  const mapOverlays = (
    <MapOverlays
      editorChrome={editorChrome}
      showLegend={infographicConfig.showLegend}
      legendTitle={dataRows.length ? 'Legend' : isPoliticalLevel ? 'Boundary source' : 'Map context'}
      legend={legendItems}
      legendFootnote={dataRows.length ? `${visualization.matchedRows}/${visualization.totalRows} rows matched` : sourceLabelForView(viewMode, districtScope, focusPlace)}
      scaleLabel={scaleLabelForView(viewMode, featureCount, districtLabel)}
      source={infographicConfig.showSource ? attributionLine(datasetMeta, infographicConfig.source) : undefined}
      callout={isPoliticalLevel && !dataRows.length
        ? {
            title: 'Political results not connected',
            detail: 'Bind an election dataset to color by winner, turnout, or margin.',
            actionLabel: 'Open data panel',
            onAction: () => setActiveNav('data'),
          }
        : null}
      annotations={annotations}
      annotationsEditable={editorMode === 'editor'}
      onAnnotationsChange={setAnnotations}
    />
  );

  const mapCanvas = (
    <MapCanvas
      viewMode={viewMode}
      selectedIds={selectedIds}
      hiddenLayers={hiddenLayers}
      style={style}
      focusPlace={focusPlace}
      placeContext={request.parentGeography}
      districtScope={districtScope}
      districtScopeLabel={districtLabel}
      onSelect={handleSelect}
      onLoad={setFeatureCount}
      onMapReady={setMapInstance}
      dataVisuals={dataVisuals}
      infographicConfig={infographicConfig}
      onFeatures={(features, loadedViewMode) => { setActiveFeatures(features); setActiveFeatureViewMode(loadedViewMode); }}
    />
  );

  return (
    <div className={`app-shell ${mobileDrawer === 'left' ? 'panel-left-open' : ''} ${mobileDrawer === 'right' ? 'panel-right-open' : ''}`.replace(/\s+/g, ' ').trim()}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><MapPinned size={18} strokeWidth={2.2} /></div>
          <div><strong>Map Studio</strong><span>Geographic visualization OS</span></div>
        </div>
        <div className="project-crumb"><span className="muted">Workspace /</span> {activeInfographic?.title ?? districtLabel ?? countryWorkspace ?? request.place ?? (viewMode === 'world' ? 'World countries' : 'Untitled map')} <ChevronDown size={14} /></div>
        <div className="topbar-actions">
          <span className={`save-status ${saveState}`}><span className="status-dot" />{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Unsaved changes'}</span>
          <button className="icon-button" aria-label="Help"><CircleHelp size={17} /></button>
          <button className="avatar" aria-label="Account menu">AS</button>
        </div>
      </header>

      <div className="workspace">
        {mobileDrawer && <button className="mobile-scrim" aria-label="Close panel" onClick={() => setMobileDrawer(null)} />}
        <aside className="left-rail">
          <button className={`rail-button ${activeNav === 'search' ? 'active' : ''}`} onClick={() => { setActiveNav('search'); setMobileDrawer('left'); }}><Search size={18} /><span>Search</span></button>
          <button className={`rail-button ${activeNav === 'layers' ? 'active' : ''}`} onClick={() => { setActiveNav('layers'); setMobileDrawer('left'); }}><Layers3 size={18} /><span>Layers</span></button>
          <button className={`rail-button ${activeNav === 'data' ? 'active' : ''}`} onClick={() => { setActiveNav('data'); setMobileDrawer('left'); }}><Database size={18} /><span>Data</span></button>
          <button className={`rail-button ${activeNav === 'charts' ? 'active' : ''}`} onClick={() => { setActiveNav('charts'); setMobileDrawer('left'); }}><BarChart3 size={18} /><span>Charts</span></button>
          <button className={`rail-button ${activeNav === 'infographics' ? 'active' : ''}`} onClick={() => { setActiveNav('infographics'); setMobileDrawer('left'); }}><Sparkles size={18} /><span>Infographics</span></button>
          <button className={`rail-button ${activeNav === 'templates' ? 'active' : ''}`} onClick={() => { setActiveNav('templates'); setMobileDrawer('left'); }}><LayoutTemplate size={18} /><span>Templates</span></button>
          <button className={`rail-button ${activeNav === 'filters' ? 'active' : ''}`} onClick={() => { setActiveNav('filters'); setMobileDrawer('left'); }}><Filter size={18} /><span>Filters</span>{filters.length > 0 && <em>{filters.length}</em>}</button>
          <button className={`rail-button ${activeNav === 'projects' ? 'active' : ''}`} onClick={() => { setActiveNav('projects'); setMobileDrawer('left'); }}><FolderOpen size={18} /><span>Projects</span></button>
          <button className={`rail-button ${activeNav === 'saved' ? 'active' : ''}`} onClick={() => { setActiveNav('saved'); setMobileDrawer('left'); }}><Bookmark size={18} /><span>Saved views</span></button>
          <button className={`rail-button ${activeNav === 'video' ? 'active' : ''}`} onClick={() => { setActiveNav('video'); setMobileDrawer('left'); }}><Video size={18} /><span>Video studio</span></button>
          <button className={`rail-button ${activeNav === 'export' ? 'active' : ''}`} onClick={() => { setActiveNav('export'); setMobileDrawer('left'); }}><Download size={18} /><span>Export</span></button>
          <button className={`rail-button ${activeNav === 'production' ? 'active' : ''}`} onClick={() => { setActiveNav('production'); setMobileDrawer('left'); }}><Factory size={18} /><span>Production</span></button>
          <div className="rail-spacer" />
          <button className="rail-button"><Settings2 size={18} /><span>Settings</span></button>
        </aside>

        <aside className="side-panel left-panel" id="left-panel" aria-label="Tools" data-open={mobileDrawer === 'left' ? 'true' : undefined}>
          <button className="mobile-drawer-close" aria-label="Close panel" onClick={() => setMobileDrawer(null)}><X size={16} /></button>
          {activeNav === 'search' && <SearchPanel searchText={searchText} setSearchText={setSearchText} onRun={handleCommand} />}
          {activeNav === 'layers' && <LayersPanel viewMode={viewMode} placeName={request.place} districtScope={districtScope} scopeLabel={districtLabel} hiddenLayers={hiddenLayers} onView={handleTab} onToggle={toggleLayer} featureCount={visibleFeatureCount} />}
          <Suspense fallback={<div className="panel-content panel-loading">Loading module…</div>}>
          {activeNav === 'data' && <DataConnectionsPanel rows={dataRows} features={activeFeatures} years={years} currentYear={currentYear} result={visualization} sources={filteredSources} datasetMeta={datasetMeta} regionOverrides={project.regionOverrides ?? {}} onRowsChange={setDataRows} onYearChange={setCurrentYear} onMetaChange={studio.patchDatasetMeta} onRegionOverride={studio.setRegionOverride} onToast={setNotice} />}
          {activeNav === 'charts' && <ChartStudioPanel compositionId={compositionId} chartOverrides={chartOverrides} rows={resolvedRows} years={years} onComposition={(id) => studio.patch({ compositionId: id, config: { ...infographicConfig, ...(compositionById(id).configPatch ?? {}), aspect: compositionById(id).aspect } })} onChartOverride={studio.setChartOverride} onResetOverrides={studio.resetChartOverrides} onToast={setNotice} />}
          {activeNav === 'infographics' && <InfographicsPanel onUse={handleInfographicTemplate} />}
          {activeNav === 'templates' && <TemplatesPanel onUse={handleTemplate} />}
          {activeNav === 'filters' && <FiltersPanel filters={filters} onRemove={removeFilter} />}
          {activeNav === 'projects' && <ProjectsPanel projects={studio.projects} activeId={project.id} role={role} brandKits={studio.brandKits} activeBrandKitId={project.brandKitId} onOpen={studio.open} onCreate={studio.create} onRename={(name) => studio.patch({ name })} onDuplicate={studio.duplicate} onArchive={studio.setArchived} onSaveVersion={studio.saveVersion} onRestoreVersion={studio.restore} onBrandKit={studio.applyBrandKitById} onToast={setNotice} accountSlot={
            <AccountPanel
              localDocuments={() => studio.projects.map((entry) => toProjectDocument(entry, studio.brandKits))}
              onOpenServerProject={(serverProject: ServerProject) => {
                if (!serverProject.document) return;
                // A server project becomes the active local project; autosave then
                // keeps the browser copy as an offline cache of the same document.
                studio.adoptDocument(serverProject.document, serverProject.name);
                hydratedProjectRef.current = undefined;
                setNotice(`Opened ${serverProject.name} from your workspace`);
              }}
              onSaveCurrentToServer={async (workspaceId) => {
                try {
                  const api = apiClientRef.current;
                  if (!api) return;
                  await api.createProject(workspaceId, project.name, renderDocument);
                  setNotice(`${project.name} saved to your workspace`);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : 'Could not save to the server');
                }
              }}
              onClient={(api) => { apiClientRef.current = api; }}
              onToast={setNotice}
            />
          } />}
          {activeNav === 'saved' && <SavedPanel title={infographicConfig.title || canvasTitle} rows={dataRows.length} annotations={annotations.length} onSave={() => { studio.saveVersion('Manual save'); markSaved(); }} onRestore={restoreProject} onToast={setNotice} />}
          {activeNav === 'video' && <VideoStudioPanel spec={videoSpec} document={renderDocument} onSpec={(patch) => setVideoSpec((current) => ({ ...current, ...patch }))} rows={resolvedRows} config={infographicConfig} years={years} viewMode={viewMode} compositionId={compositionId} templateId={activeInfographic?.id ?? 'custom-map'} annotations={annotations} currentYear={currentYear} previewFrame={previewFrame} onPreviewFrame={(frame) => { setPreviewFrame(frame); setPixelVideoActive(true); }} onToast={setNotice} />}
          {activeNav === 'export' && <ExportStudioPanel map={mapInstance} compositionId={compositionId} config={infographicConfig} chartOverrides={chartOverrides} legend={visualization.legend} annotations={annotations} rows={resolvedRows} currentYear={displayYear} datasetMeta={datasetMeta} logoDataUrl={studio.brandKits.find((kit) => kit.id === project.brandKitId)?.logoDataUrl} canExport={can(role, 'export')} fileStem={canvasTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map-infographic'} onToast={setNotice} />}
          </Suspense>
          {activeNav === 'production' && <ProductionPanel templateId={activeInfographic?.id ?? 'custom-map'} viewMode={viewMode} onToast={setNotice} />}
        </aside>

        <main className="main-canvas">
          <div className="command-row">
            <div className="command-input-wrap">
              <Sparkles size={17} className="command-icon" />
              <input ref={commandInputRef} value={commandText} onChange={(event) => setCommandText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && commandText.trim()) handleCommand(commandText.trim()); }} placeholder="Describe a map or edit the current view…" aria-label="AI map command" />
              <kbd><Command size={12} /> K</kbd>
            </div>
            <button className="run-button" onClick={() => commandText.trim() && handleCommand(commandText.trim())}>Run</button>
          </div>

          <div className="canvas-header">
            <div>
              <div className="breadcrumb"><span>{rootGeography}</span><span>/</span><strong>{displayGeography}</strong><span>/</span><span>{canvasTitle}</span></div>
              <div className="canvas-title-row"><h1>{canvasTitle}</h1><span className="soft-badge">{activeInfographic ? `${activeInfographic.category} infographic` : requestLabel}</span></div>
            </div>
            <div className="canvas-actions">
              <button className="small-button" onClick={undo} aria-label="Undo"><Undo2 size={15} /></button>
              <button className="small-button" onClick={redo} aria-label="Redo"><Redo2 size={15} /></button>
              <div className="segmented-control"><button className={editorMode === 'viewer' ? 'active' : ''} onClick={() => setEditorMode('viewer')}>Viewer</button><button className={editorMode === 'editor' ? 'active' : ''} onClick={() => setEditorMode('editor')}>Editor</button></div>
              <button className="mobile-drawer-toggle" onClick={() => setMobileDrawer((current) => (current === 'right' ? null : 'right'))} aria-expanded={mobileDrawer === 'right'} aria-controls="right-panel"><SlidersHorizontal size={15} /> Design</button>
              <button className="outline-button" onClick={() => setNotice('Interactive share link ready to configure')}><Share2 size={15} /> Share</button>
              <button className="outline-button pixel-video-action" onClick={() => { setActiveNav('video'); setMobileDrawer('left'); }}><Video size={15} /> Pixel video</button>
              <button className="primary-button" onClick={() => { markSaved(); setActiveNav('export'); }}><Download size={15} /> Export</button>
            </div>
          </div>

          <div className={`map-frame aspect-${infographicConfig.aspect.replace(':', '-')} ${pixelVideoActive ? 'pixel-video-active' : ''} ${isEditorialStory ? 'editorial-story' : ''} ${isStatistaStory ? 'statista-story' : ''} ${isComposed ? 'composed' : ''}`} style={{ background: infographicConfig.background, opacity: isVideoRenderMode ? videoFrame.opacity : 1 }}>
            <div className="map-tabs">
              <button className={viewMode === 'place' ? 'active' : ''} onClick={() => handleTab('place')}>Place</button>
              <button className={viewMode === 'india' || isIndiaLevel ? 'active' : ''} onClick={() => handleTab('india')}>India</button>
              <button className={viewMode === 'usa' || isUsaLevel ? 'active' : ''} onClick={() => handleTab('usa')}>USA</button>
              <button className={viewMode === 'china' || isChinaLevel ? 'active' : ''} onClick={() => handleTab('china')}>China</button>
              <button className={viewMode === 'jammu-kashmir' ? 'active' : ''} onClick={() => handleTab('jammu-kashmir')}>J&amp;K</button>
              <button className={viewMode === 'state' ? 'active' : ''} onClick={() => handleTab('state')}>State</button>
              {(viewMode === 'india' || isIndiaLevel) && <>
                <button className={viewMode === 'india-districts' ? 'active' : ''} onClick={() => handleTab('india-districts')}>Districts</button>
                <button className={viewMode === 'india-assembly' ? 'active' : ''} onClick={() => handleTab('india-assembly')}>MLA seats</button>
                <button className={viewMode === 'india-parliament' ? 'active' : ''} onClick={() => handleTab('india-parliament')}>MP seats</button>
              </>}
              {(viewMode === 'usa' || isUsaLevel) && <>
                <button className={viewMode === 'usa-counties' ? 'active' : ''} onClick={() => handleTab('usa-counties')}>Counties</button>
                <button className={viewMode === 'usa-state-house' ? 'active' : ''} onClick={() => handleTab('usa-state-house')}>State House</button>
                <button className={viewMode === 'usa-congress' ? 'active' : ''} onClick={() => handleTab('usa-congress')}>Congress</button>
              </>}
              {(viewMode === 'china' || isChinaLevel) && <>
                <button className={viewMode === 'china-prefectures' ? 'active' : ''} onClick={() => handleTab('china-prefectures')}>Prefectures</button>
                <button className={viewMode === 'china-counties' ? 'active' : ''} onClick={() => handleTab('china-counties')}>Local congress</button>
                <button className={viewMode === 'china-npc' ? 'active' : ''} onClick={() => handleTab('china-npc')}>NPC units</button>
              </>}
              <button className={viewMode === 'cities' ? 'active' : ''} onClick={() => handleTab('cities')}>Top cities</button>
              <button className={viewMode === 'world' ? 'active' : ''} onClick={() => handleTab('world')}>World</button>
            </div>
            {isComposed
              ? (
                <CompositionCanvas
                  composition={composition}
                  config={infographicConfig}
                  rows={resolvedRows}
                  currentYear={displayYear}
                  chartOverrides={chartOverrides}
                  aspect={infographicConfig.aspect}
                  editorChrome={editorChrome}
                  mapSlot={hasMapBlock ? mapCanvas : null}
                  mapOverlays={hasMapBlock ? mapOverlays : null}
                />
              )
              : (
                <div className="map-stage">
                  {mapCanvas}
                  {mapOverlays}
                </div>
              )}
            {isEditorialStory && <>
              <div className="editorial-kicker"><span>{activeInfographic?.kicker ?? 'EDITORIAL MAP STORY'}</span><i /> <span>EDITABLE TEMPLATE</span></div>
              <div className="editorial-stat-card"><span>{activeInfographic?.statsHook.label}</span><strong>{activeInfographic?.statsHook.value}</strong>{activeInfographic?.statsHook.delta && <small>{activeInfographic.statsHook.delta}</small>}</div>
            </>}
            {isStatistaStory && <StatistaStoryOverlay rows={dataRows} config={infographicConfig} currentYear={currentYear} kicker={activeInfographic?.kicker ?? 'MAP DATA · RANKED COMPARISON'} statsHook={activeInfographic?.statsHook} />}
            {infographicConfig.showTitle && !isComposed && <div className="infographic-title-overlay"><h2>{infographicConfig.title || currentTitle}</h2>{infographicConfig.subtitle && <p>{infographicConfig.subtitle}</p>}{currentYear && <span>{currentYear}</span>}</div>}
            {pixelVideoActive && <div className="pixel-video-overlay" aria-hidden="true" />}
            {/* The logo is opt-in: it appears only when showLogo is set and a brand
                kit actually supplies one, in the editor and in rendered frames alike. */}
            {videoSpec.showLogo && activeLogoDataUrl && (
              <img
                className="composition-logo"
                src={activeLogoDataUrl}
                alt={`${activeBrandKitName} logo`}
                style={{ position: 'absolute', right: '2.5%', top: '3%', maxWidth: '11%', maxHeight: '11%', objectFit: 'contain', pointerEvents: 'none', zIndex: 6 }}
              />
            )}
            {infographicConfig.showSource && !isComposed && <div className="infographic-source-overlay">{attributionLine(datasetMeta, infographicConfig.source)}</div>}
          </div>

          <div className="canvas-footer"><span><span className="status-dot" /> Auto-save enabled</span><span>·</span><span>Source-backed geometry</span><span>·</span><span>Attribution included</span></div>
        </main>

        <aside className="side-panel right-panel" id="right-panel" aria-label="Design" data-open={mobileDrawer === 'right' ? 'true' : undefined}>
          <button className="mobile-drawer-close" aria-label="Close panel" onClick={() => setMobileDrawer(null)}><X size={16} /></button>
          {selectedEntity ? <SelectionPanel entity={selectedEntity} onClear={() => { setSelectedEntity(null); setSelection([]); }} /> : <InfographicEditorPanel editorMode={editorMode} style={style} hiddenLayers={hiddenLayers} config={infographicConfig} annotations={annotations} onStyle={setStyle} onToggle={toggleLayer} onConfig={patchInfographicConfig} onAnnotations={setAnnotations} />}
        </aside>
      </div>

      {notice && <div className="toast"><Check size={15} /> {notice}</div>}
    </div>
  );
}

function SearchPanel({ searchText, setSearchText, onRun }: { searchText: string; setSearchText: (value: string) => void; onRun: (value: string) => void }) {
  return <div className="panel-content"><PanelHeading icon={<Search size={16} />} title="Search places" detail="Resolve a geographic entity" /><div className="search-box"><Search size={15} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && searchText) onRun(searchText); }} placeholder="Search state, district, town…" /></div><div className="panel-label">Try a command</div>{suggestions.map((suggestion) => <button className="suggestion" key={suggestion} onClick={() => onRun(suggestion)}><Sparkles size={13} />{suggestion}</button>)}<div className="search-footnote"><MapPinned size={14} /><span>Search is deterministic first. Ambiguous matches stay reviewable.</span></div></div>;
}

function LayersPanel({ viewMode, placeName, districtScope, scopeLabel, hiddenLayers, onView, onToggle, featureCount }: { viewMode: ViewMode; placeName?: string; districtScope?: string; scopeLabel?: string; hiddenLayers: Record<string, boolean>; onView: (mode: ViewMode) => void; onToggle: (layer: string) => void; featureCount: number }) {
  const scopedDistrict = templateForScope(districtScope);
  const isIndiaLevel = INDIA_LEVELS.includes(viewMode);
  const isUsaLevel = USA_LEVELS.includes(viewMode);
  const isChinaLevel = CHINA_LEVELS.includes(viewMode);
  const countryLabel = viewMode === 'usa' || isUsaLevel ? 'USA' : viewMode === 'china' || isChinaLevel ? 'China' : 'India';
  const geographyLabel = scopeLabel ?? scopedDistrict?.label ?? countryLabel;
  const layers = viewMode === 'world' ? [{ id: 'world', label: 'World countries', meta: `${featureCount} entities`, visible: true }, { id: 'labels', label: 'Country labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
    : viewMode === 'india' ? [{ id: 'india', label: 'Clickable India states and UTs', meta: `${featureCount} entities · click to drill down`, visible: true }, { id: 'labels', label: 'State and UT labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
      : viewMode === 'india-districts' ? [{ id: 'india-districts', label: `${geographyLabel} districts`, meta: `${featureCount} district boundaries`, visible: true }, { id: 'labels', label: 'District labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
        : viewMode === 'india-assembly' ? [{ id: 'india-assembly', label: `${geographyLabel} MLA constituencies`, meta: `${featureCount} seats`, visible: true }, { id: 'districts', label: 'District boundaries', meta: districtScope ? 'State context' : 'National context', visible: !hiddenLayers.districts }, { id: 'labels', label: 'MLA seat labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
          : viewMode === 'india-parliament' ? [{ id: 'india-parliament', label: `${geographyLabel} MP constituencies`, meta: `${featureCount} seats · 2019 boundaries`, visible: true }, { id: 'districts', label: 'District boundaries', meta: districtScope ? 'State context' : 'National context', visible: !hiddenLayers.districts }, { id: 'labels', label: 'MP seat labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
            : viewMode === 'usa' ? [{ id: 'usa', label: 'Clickable USA states and DC', meta: `${featureCount} entities · click to drill down`, visible: true }, { id: 'labels', label: 'State labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
              : viewMode === 'usa-counties' ? [{ id: 'usa-counties', label: `${geographyLabel} counties`, meta: `${featureCount} county equivalents`, visible: true }, { id: 'labels', label: 'County labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                : viewMode === 'usa-state-house' ? [{ id: 'usa-state-house', label: `${geographyLabel} State House districts`, meta: `${featureCount} lower-chamber districts · 2024`, visible: true }, { id: 'districts', label: 'County boundaries', meta: districtScope ? 'State context' : 'National context', visible: !hiddenLayers.districts }, { id: 'labels', label: 'District labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                  : viewMode === 'usa-congress' ? [{ id: 'usa-congress', label: `${geographyLabel} Congressional districts`, meta: `${featureCount} districts · 119th Congress`, visible: true }, { id: 'districts', label: 'County boundaries', meta: districtScope ? 'State context' : 'National context', visible: !hiddenLayers.districts }, { id: 'labels', label: 'District labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                    : viewMode === 'china' ? [{ id: 'china', label: 'Clickable China provinces', meta: `${featureCount} geographic units · click to drill down`, visible: true }, { id: 'labels', label: 'Province labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                      : viewMode === 'china-prefectures' ? [{ id: 'china-prefectures', label: `${geographyLabel} prefectures`, meta: `${featureCount} prefecture-level units`, visible: true }, { id: 'labels', label: 'Prefecture labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                        : viewMode === 'china-counties' ? [{ id: 'china-counties', label: `${geographyLabel} county congress context`, meta: `${featureCount} county-level units`, visible: true }, { id: 'labels', label: 'County labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                          : viewMode === 'china-npc' ? [{ id: 'china-npc', label: `${geographyLabel} NPC electoral-unit context`, meta: `${featureCount} province-level units · not constituency polygons`, visible: true }, { id: 'labels', label: 'Province labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                : viewMode === 'jammu-kashmir' ? [{ id: 'jammu-kashmir', label: 'J&K + Ladakh districts', meta: `${featureCount} J&K districts`, visible: true }, { id: 'labels', label: 'District and UT labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                  : viewMode === 'place' ? [{ id: 'place', label: 'Place result', meta: placeName?.toLowerCase() === 'india' ? 'Official India boundary' : 'OSM place context', visible: true }]
                    : viewMode === 'cities' ? [{ id: 'cities', label: 'Top 100 city points', meta: 'Census 2011-derived', visible: true }, { id: 'labels', label: 'City labels', meta: 'Automatic', visible: !hiddenLayers.labels }]
                      : viewMode === 'assembly' || viewMode === 'delhi-assembly' ? [{ id: viewMode, label: 'Assembly constituencies', meta: `${featureCount} entities`, visible: true }, { id: 'districts', label: 'District boundaries', meta: 'Context layer', visible: !hiddenLayers.districts }]
                        : [{ id: viewMode, label: viewMode === 'district' ? 'District boundaries' : placeName ?? 'State boundary', meta: `${featureCount} entities`, visible: true }, { id: 'labels', label: 'Place labels', meta: 'Automatic', visible: !hiddenLayers.labels }];
  return <div className="panel-content">
    <PanelHeading icon={<Layers3 size={16} />} title="Layers" detail="Drag to reorder in editor" />
    <div className="mode-switch cities-mode">
      <button className={viewMode === 'place' ? 'active' : ''} onClick={() => onView('place')}>Place</button>
      <button className={viewMode === 'india' || isIndiaLevel ? 'active' : ''} onClick={() => onView('india')}>India</button>
      <button className={viewMode === 'usa' || isUsaLevel ? 'active' : ''} onClick={() => onView('usa')}>USA</button>
      <button className={viewMode === 'china' || isChinaLevel ? 'active' : ''} onClick={() => onView('china')}>China</button>
      <button className={viewMode === 'jammu-kashmir' ? 'active' : ''} onClick={() => onView('jammu-kashmir')}>J&amp;K</button>
      <button className={viewMode === 'world' ? 'active' : ''} onClick={() => onView('world')}>World</button>
      <button className={viewMode === 'state' ? 'active' : ''} onClick={() => onView('state')}>State</button>
      {(viewMode === 'india' || isIndiaLevel) && <>
        <button className={viewMode === 'india-districts' ? 'active' : ''} onClick={() => onView('india-districts')}>Districts</button>
        <button className={viewMode === 'india-assembly' ? 'active' : ''} onClick={() => onView('india-assembly')}>MLA seats</button>
        <button className={viewMode === 'india-parliament' ? 'active' : ''} onClick={() => onView('india-parliament')}>MP seats</button>
      </>}
      {(viewMode === 'usa' || isUsaLevel) && <>
        <button className={viewMode === 'usa-counties' ? 'active' : ''} onClick={() => onView('usa-counties')}>Counties</button>
        <button className={viewMode === 'usa-state-house' ? 'active' : ''} onClick={() => onView('usa-state-house')}>State House</button>
        <button className={viewMode === 'usa-congress' ? 'active' : ''} onClick={() => onView('usa-congress')}>Congress</button>
      </>}
      {(viewMode === 'china' || isChinaLevel) && <>
        <button className={viewMode === 'china-prefectures' ? 'active' : ''} onClick={() => onView('china-prefectures')}>Prefectures</button>
        <button className={viewMode === 'china-counties' ? 'active' : ''} onClick={() => onView('china-counties')}>Local congress</button>
        <button className={viewMode === 'china-npc' ? 'active' : ''} onClick={() => onView('china-npc')}>NPC units</button>
      </>}
      <button className={viewMode === 'cities' ? 'active' : ''} onClick={() => onView('cities')}>Top cities</button>
    </div>
    {(viewMode === 'india' || isIndiaLevel) && <div className="map-level-card">
      <div className="panel-label">Map level · {districtScope ? geographyLabel : 'All India'}</div>
      <div className="map-level-switch">
        <button className={viewMode === 'india-districts' ? 'active' : ''} onClick={() => onView('india-districts')}><MapIcon size={13} />District map</button>
        <button className={viewMode === 'india-assembly' ? 'active' : ''} onClick={() => onView('india-assembly')}><Users size={13} />MLA map</button>
        <button className={viewMode === 'india-parliament' ? 'active' : ''} onClick={() => onView('india-parliament')}><Landmark size={13} />MP map</button>
      </div>
    </div>}
    {(viewMode === 'usa' || isUsaLevel) && <div className="map-level-card">
      <div className="panel-label">Map level · {districtScope ? geographyLabel : 'All USA'}</div>
      <div className="map-level-switch">
        <button className={viewMode === 'usa-counties' ? 'active' : ''} onClick={() => onView('usa-counties')}><MapIcon size={13} />County map</button>
        <button className={viewMode === 'usa-state-house' ? 'active' : ''} onClick={() => onView('usa-state-house')}><Users size={13} />State House</button>
        <button className={viewMode === 'usa-congress' ? 'active' : ''} onClick={() => onView('usa-congress')}><Landmark size={13} />Congress map</button>
      </div>
    </div>}
    {(viewMode === 'china' || isChinaLevel) && <div className="map-level-card">
      <div className="panel-label">Map level · {districtScope ? geographyLabel : 'All China'}</div>
      <div className="map-level-switch">
        <button className={viewMode === 'china-prefectures' ? 'active' : ''} onClick={() => onView('china-prefectures')}><MapIcon size={13} />Prefecture map</button>
        <button className={viewMode === 'china-counties' ? 'active' : ''} onClick={() => onView('china-counties')}><Users size={13} />Local congress</button>
        <button className={viewMode === 'china-npc' ? 'active' : ''} onClick={() => onView('china-npc')}><Landmark size={13} />NPC units</button>
      </div>
    </div>}
    <div className="layer-list">{layers.map((layer, index) => <div className="layer-item" key={layer.id}><span className="drag-dots">⋮⋮</span><span className="layer-color" style={{ background: index === 0 ? (viewMode === 'jammu-kashmir' ? '#f4c542' : '#6479e8') : '#a9b3c4' }} /><div className="layer-copy"><strong>{layer.label}</strong><small>{layer.meta}</small></div><button className="layer-eye" onClick={() => onToggle(layer.id)} aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.label}`}>{layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button></div>)}</div>
    <button className="add-layer"><span>+</span> Add layer</button>
    <div className="panel-divider" />
    <div className="panel-label">Available modules</div>
    <div className="module-row"><span><MapIcon size={14} /> Roads & water</span><span className="unavailable">Coming soon</span></div>
    <div className="module-row"><span><Database size={14} /> Election results</span><span className="unavailable">Bind data</span></div>
  </div>;
}

function InfographicsPanel({ onUse }: { onUse: (template: InfographicTemplate) => void }) {
  const [searchText, setSearchText] = useState('');
  const [category, setCategory] = useState<'All' | InfographicCategory>('All');
  const [collection, setCollection] = useState<'All' | 'Library' | 'Demo test pack'>('All');
  const visibleTemplates = searchInfographicTemplates(searchText, category, collection);
  return <div className="panel-content templates-panel infographics-panel">
    <PanelHeading icon={<BarChart3 size={16} />} title="Infographics" detail="The integrated InfoGraphics story library" />
    <div className="template-intro infographic-intro"><Sparkles size={16} /><div><strong>Build a data story</strong><span>Pick a storyboard, bind verified data, style the map, then export a still or animated video.</span></div></div>
    <div className="test-pack-summary"><div><strong>Demo test pack</strong><span>Synthetic values · safe for feature testing</span></div><div><span><b>{testMapInfographicTemplates.length}</b><small>maps</small></span><span><b>{testGeneralInfographicTemplates.length}</b><small>stories</small></span><span><b>{testVideoTemplates.length}</b><small>video</small></span></div></div>
    <div className="template-collection-switch" aria-label="Template collection"><button className={collection === 'All' ? 'active' : ''} onClick={() => setCollection('All')}>All</button><button className={collection === 'Demo test pack' ? 'active' : ''} onClick={() => setCollection('Demo test pack')}>Demo pack</button><button className={collection === 'Library' ? 'active' : ''} onClick={() => setCollection('Library')}>Library</button></div>
    <div className="template-search"><Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search topics, places, or chart types…" aria-label="Find an infographic" /></div>
    <label className="template-category"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as 'All' | InfographicCategory)}>{infographicCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
    <div className="panel-label">Templates · {visibleTemplates.length} of {infographicTemplates.length}</div>
    <div className="template-stack">{visibleTemplates.map((template) => <article className={`infographic-template-card ${template.featured ? 'featured' : ''}`} key={template.id}>
      <div className="infographic-template-preview" style={{ color: template.previewColor, background: `${template.previewColor}12` }}>
        <div className="mini-chart" aria-hidden="true"><i /><i /><i /><i /></div>
        <span>{template.recommendedChart}</span>
      </div>
      <div className="infographic-template-copy">
        <div className="template-kicker"><span>{template.category}</span>{template.sampleRows?.length ? <em>Ready data</em> : template.collection === 'test-map' ? <em>Map demo</em> : template.collection === 'test-infographic' ? <em>Story demo</em> : template.collection === 'test-video' ? <em>Video demo</em> : template.openPanel === 'video' ? <em>Video</em> : null}</div>
        <strong>{template.title}</strong>
        <small>{template.description}</small>
        <div className="template-stat"><b>{template.statsHook.value}</b><span>{template.statsHook.label}</span></div>
        <div className="template-meta"><span>{template.geoScope ?? 'Global'}</span><span>{template.aspectRatios.join(' · ')}</span><span>{template.defaultDurationSeconds}s</span></div>
      </div>
      <button className="template-use infographic-use" onClick={() => onUse(template)}><FileImage size={13} /> Use story</button>
    </article>)}</div>
    {visibleTemplates.length === 0 && <div className="empty-panel"><Search size={20} /><strong>No matching infographics</strong><span>Try another topic, geography, or category.</span></div>}
    <p className="panel-note"><Sparkles size={14} /> Demo-pack values are synthetic. Replace them with a verified CSV, spreadsheet, or pasted table before publishing.</p>
  </div>;
}

function TemplatesPanel({ onUse }: { onUse: (template: DistrictTemplate) => void }) {
  const [searchText, setSearchText] = useState('');
  const normalizedSearch = searchText.trim().toLowerCase();
  const visibleTemplates = districtTemplates.filter((template) => !normalizedSearch || `${template.label} ${template.detail}`.toLowerCase().includes(normalizedSearch));
  const visibleCountryTemplates = countryTemplates.filter((template) => !normalizedSearch || `${template.label} ${template.detail}`.toLowerCase().includes(normalizedSearch));
  const renderTemplate = (template: DistrictTemplate) => <article className={`template-card ${template.featured ? 'featured' : ''}`} key={template.id}><div className="template-preview"><MapIcon size={17} /><strong>{template.districtCount}</strong><small>{template.metricLabel ?? 'districts'}</small></div><div className="template-copy"><strong>{template.label}</strong><small>{template.detail}</small></div><button className="template-use" onClick={() => onUse(template)}><FileImage size={13} /> Use</button></article>;
  return <div className="panel-content templates-panel"><PanelHeading icon={<LayoutTemplate size={16} />} title="Map templates" detail="District and country geometry library" /><div className="template-intro"><FileImage size={16} /><div><strong>Start with a map template</strong><span>Choose a bundled map, then style, label, annotate, and export it.</span></div></div><div className="template-search"><Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Find a state, country, or region…" aria-label="Find a map template" /></div><div className="panel-label">District map templates · {districtTemplates.length}</div><div className="template-stack">{visibleTemplates.map(renderTemplate)}</div><div className="panel-label">Country map templates · {countryTemplates.length}</div><div className="template-stack">{visibleCountryTemplates.map(renderTemplate)}</div>{visibleTemplates.length === 0 && visibleCountryTemplates.length === 0 && <div className="empty-panel"><Search size={20} /><strong>No matching templates</strong><span>Try a state, country, or region name.</span></div>}<p className="panel-note"><Sparkles size={14} /> Every card uses source-backed geometry and opens directly in the editor.</p></div>;
}

function FiltersPanel({ filters, onRemove }: { filters: FilterSpec[]; onRemove: (id: string) => void }) {
  return <div className="panel-content"><PanelHeading icon={<Filter size={16} />} title="Filters" detail="Applied to the active layer" />{filters.length === 0 ? <div className="empty-panel"><SlidersHorizontal size={22} /><strong>No filters yet</strong><span>Use the command bar to add a deterministic filter, for example “margin under 5%”.</span></div> : <div className="filter-stack">{filters.map((filter) => <div className="filter-chip large" key={filter.id}><span>{filter.label}</span><button onClick={() => onRemove(filter.id)} aria-label={`Remove ${filter.label}`}><X size={13} /></button></div>)}</div>}<button className="add-layer"><span>+</span> Add filter</button></div>;
}

function SavedPanel({ title, rows, annotations, onSave, onRestore, onToast }: { title: string; rows: number; annotations: number; onSave: () => void; onRestore: (project: StoredProject) => void; onToast: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      const project = JSON.parse(await file.text()) as StoredProject;
      if (!project.config && !project.rows) throw new Error('This is not a Map Studio project file');
      onRestore(project);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not restore the project');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return <div className="panel-content"><PanelHeading icon={<Bookmark size={16} />} title="Saved project" detail="Auto-saved in this browser" /><div className="saved-card active"><div><strong>{title}</strong><small>{rows} data rows · {annotations} annotations</small></div><Check size={15} /></div><button className="outline-button wide" onClick={() => { onSave(); onToast('Current project saved in this browser'); }}><Save size={15} /> Save current project</button><button className="outline-button wide" onClick={() => inputRef.current?.click()}><ArrowUpRight size={15} /> Restore project JSON</button><input ref={inputRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => void importProject(event.target.files?.[0])} /><p className="panel-note">The project keeps your data, scale, titles, canvas settings, annotations, and active year. Download a portable JSON copy from Export.</p></div>;
}

function SelectionPanel({ entity, onClear }: { entity: ResolvedEntity; onClear: () => void }) {
  return <div className="panel-content selection-content"><div className="selection-heading"><div><span className="eyebrow">SELECTED ENTITY</span><h2>{entity.name}</h2></div><button className="icon-button" onClick={onClear} aria-label="Clear selection"><X size={16} /></button></div><div className="selection-tags"><span>{entity.entityType.replace(/_/g, ' ')}</span><span>{Math.round(entity.confidence * 100)}% match</span></div><div className="detail-grid"><div><small>Parent geography</small><strong>{entity.parentName}</strong></div><div><small>District</small><strong>{entity.districtName ?? '—'}</strong></div><div><small>Stable entity ID</small><strong className="mono">{entity.id}</strong></div><div><small>Boundary source</small><strong>{entity.sourceId}</strong></div></div><div className="detail-section"><div className="section-title"><span>Political result</span><span className="unavailable">Unavailable</span></div><div className="unavailable-card"><Database size={15} /><span>Connect an election result dataset to show winner, margin, turnout, and historical trend.</span></div></div><div className="detail-section"><div className="section-title"><span>Quick actions</span></div><button className="outline-button wide"><Palette size={15} /> Style selected region</button><button className="outline-button wide"><Type size={15} /> Label with entity name</button></div></div>;
}

function PanelHeading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="panel-heading"><div className="panel-title"><span className="panel-title-icon">{icon}</span><div><h2>{title}</h2><span>{detail}</span></div></div><button className="icon-button"><Settings2 size={15} /></button></div>;
}

function commandNotice(command: EditorCommand) {
  if (command.type === 'set-view') return `View switched to ${command.viewMode}`;
  if (command.type === 'set-filter') return `Filter applied · ${command.filter.label}`;
  if (command.type === 'select-color') return 'Selection style updated';
  if (command.type === 'set-layer') return `${command.layer} ${command.visible ? 'shown' : 'hidden'}`;
  if (command.type === 'fit-place') return `Zooming to ${command.place}`;
  if (command.type === 'presentation-ready') return 'Presentation style applied';
  return 'Export queued';
}
