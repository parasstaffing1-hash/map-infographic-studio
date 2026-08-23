import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BarChart3, Bookmark, Check, ChevronDown, CircleHelp, Command, Database, Download, Eye, EyeOff, Factory, FileImage, Filter, Landmark, Layers3, LayoutTemplate, Map as MapIcon, MapPinned, Palette, Redo2, Save, Search, Settings2, Share2, SlidersHorizontal, Sparkles, Type, Undo2, Users, Video, X } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AnnotationLayer } from './components/AnnotationLayer';
import { InfographicEditorPanel } from './components/InfographicEditorPanel';
import { MapCanvas } from './components/MapCanvas';
import { ProductionPanel } from './components/ProductionPanel';
import { sourceCatalog } from './domain/data';
import { createVisualization, dataYears, DEFAULT_INFOGRAPHIC_CONFIG, type Annotation, type DataRow, type InfographicConfig } from './domain/infographic';
import { configForInfographicTemplate, infographicCategories, infographicTemplates, rowsForInfographicTemplate, searchInfographicTemplates, testGeneralInfographicTemplates, testMapInfographicTemplates, testVideoTemplates, type InfographicCategory, type InfographicTemplate } from './domain/infographicTemplates';
import { parseMapRequest } from './domain/parser';
import { countryTemplates, districtTemplates, templateForScope, type DistrictTemplate } from './domain/templates';
import type { EditorCommand, FilterSpec, GeoFeature, ResolvedEntity, ViewMode } from './domain/types';
import { useMapStudio } from './store/useMapStudio';

const DataBindingPanel = lazy(() => import('./components/DataBindingPanel').then((module) => ({ default: module.DataBindingPanel })));
const ExportPanel = lazy(() => import('./components/ExportPanel').then((module) => ({ default: module.ExportPanel })));
const PixelVideoPanel = lazy(() => import('./components/PixelVideoPanel').then((module) => ({ default: module.PixelVideoPanel })));

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
    setCommandText, runCommand, setViewMode, setEditorMode, toggleLayer, setSelection, setStyle, removeFilter, undo, redo, markSaved,
  } = useMapStudio();
  const storedProject = useMemo(readStoredProject, []);
  const [selectedEntity, setSelectedEntity] = useState<ResolvedEntity | null>(null);
  const [focusPlace, setFocusPlace] = useState<string | undefined>(request.viewport.fitEntity);
  const [activeNav, setActiveNav] = useState<'search' | 'layers' | 'data' | 'infographics' | 'templates' | 'filters' | 'saved' | 'video' | 'export' | 'production'>('layers');
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [pixelVideoActive, setPixelVideoActive] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [featureCount, setFeatureCount] = useState(1);
  const [notice, setNotice] = useState('');
  const [districtScope, setDistrictScope] = useState<string | undefined>();
  const [activeFeatures, setActiveFeatures] = useState<GeoFeature[]>([]);
  const [activeFeatureViewMode, setActiveFeatureViewMode] = useState<ViewMode>();
  const [dataRows, setDataRows] = useState<DataRow[]>(storedProject?.rows ?? []);
  const [infographicConfig, setInfographicConfig] = useState<InfographicConfig>({ ...DEFAULT_INFOGRAPHIC_CONFIG, ...storedProject?.config });
  const [annotations, setAnnotations] = useState<Annotation[]>(storedProject?.annotations ?? []);
  const [currentYear, setCurrentYear] = useState<string | undefined>(storedProject?.currentYear);
  const [activeInfographicId, setActiveInfographicId] = useState<string>();

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
  const visualization = useMemo(() => createVisualization(dataRows, activeFeatures, currentYear, infographicConfig), [activeFeatures, currentYear, dataRows, infographicConfig]);
  const dataVisuals = dataRows.length ? visualization.byFeatureId : {};

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('render') !== '1') return;
    document.body.classList.add('render-mode');
    const requestedView = params.get('viewMode') as ViewMode | null;
    if (requestedView && PRODUCTION_VIEW_MODES.includes(requestedView)) setViewMode(requestedView);
    setEditorMode('viewer');
    return () => document.body.classList.remove('render-mode');
  }, [setEditorMode, setViewMode]);

  useEffect(() => {
    if (currentYear && !years.includes(currentYear)) setCurrentYear(years.at(-1));
  }, [currentYear, years]);

  useEffect(() => {
    localStorage.setItem('map-studio-infographic-v1', JSON.stringify({ rows: dataRows, config: infographicConfig, annotations, currentYear }));
  }, [annotations, currentYear, dataRows, infographicConfig]);

  useEffect(() => {
    if (!activeInfographic?.demoMode || activeFeatureViewMode !== activeInfographic.viewMode || viewMode !== activeInfographic.viewMode || !activeFeatures.length) return;
    const rows = rowsForInfographicTemplate(activeInfographic, activeFeatures);
    if (!rows.length) return;
    setDataRows(rows);
    const demoYears = dataYears(rows);
    setCurrentYear(demoYears.at(-1));
    setNotice(`${activeInfographic.title} ready · ${rows.length} synthetic demo rows`);
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [activeFeatureViewMode, activeFeatures, activeInfographic, viewMode]);

  const patchInfographicConfig = useCallback((patch: Partial<InfographicConfig>) => setInfographicConfig((current) => ({ ...current, ...patch })), []);
  const restoreProject = useCallback((project: StoredProject) => {
    if (Array.isArray(project.rows)) setDataRows(project.rows);
    if (project.config) setInfographicConfig((current) => ({ ...current, ...project.config }));
    if (Array.isArray(project.annotations)) setAnnotations(project.annotations);
    setCurrentYear(project.currentYear);
    setNotice('Editable infographic project restored');
  }, []);

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
    const rows = rowsForInfographicTemplate(template);
    setActiveInfographicId(template.id);
    setDistrictScope(undefined);
    setFocusPlace(template.geoScope === 'Chile' ? 'Chile' : undefined);
    setViewMode(template.viewMode);
    setEditorMode('editor');
    setSelectedEntity(null);
    setSelection([]);
    setInfographicConfig(configForInfographicTemplate(template));
    setDataRows(rows);
    setCurrentYear(rows.some((row) => row.year === '2024') ? '2024' : undefined);
    setAnnotations([{
      id: `template-stat-${template.id}`,
      type: 'text',
      text: `${template.statsHook.value} · ${template.statsHook.label}`,
      x: 81,
      y: 16,
      color: template.previewColor,
      size: 12,
    }]);
    setStyle({ fill: template.previewColor, opacity: 0.84, lineWidth: 1.6 });
    setPixelVideoActive(template.openPanel === 'video');
    setActiveNav(template.openPanel);
    setNotice(template.demoMode ? `${template.title} · preparing synthetic demo data` : rows.length ? `${template.title} loaded with ${rows.length} source rows` : `${template.title} storyboard ready · connect data to publish`);
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

  return (
    <div className="app-shell">
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
        <aside className="left-rail">
          <button className={`rail-button ${activeNav === 'search' ? 'active' : ''}`} onClick={() => setActiveNav('search')}><Search size={18} /><span>Search</span></button>
          <button className={`rail-button ${activeNav === 'layers' ? 'active' : ''}`} onClick={() => setActiveNav('layers')}><Layers3 size={18} /><span>Layers</span></button>
          <button className={`rail-button ${activeNav === 'data' ? 'active' : ''}`} onClick={() => setActiveNav('data')}><Database size={18} /><span>Data</span></button>
          <button className={`rail-button ${activeNav === 'infographics' ? 'active' : ''}`} onClick={() => setActiveNav('infographics')}><BarChart3 size={18} /><span>Infographics</span></button>
          <button className={`rail-button ${activeNav === 'templates' ? 'active' : ''}`} onClick={() => setActiveNav('templates')}><LayoutTemplate size={18} /><span>Templates</span></button>
          <button className={`rail-button ${activeNav === 'filters' ? 'active' : ''}`} onClick={() => setActiveNav('filters')}><Filter size={18} /><span>Filters</span>{filters.length > 0 && <em>{filters.length}</em>}</button>
          <button className={`rail-button ${activeNav === 'saved' ? 'active' : ''}`} onClick={() => setActiveNav('saved')}><Bookmark size={18} /><span>Saved views</span></button>
          <button className={`rail-button ${activeNav === 'video' ? 'active' : ''}`} onClick={() => setActiveNav('video')}><Video size={18} /><span>Pixel video</span></button>
          <button className={`rail-button ${activeNav === 'export' ? 'active' : ''}`} onClick={() => setActiveNav('export')}><Download size={18} /><span>Export</span></button>
          <button className={`rail-button ${activeNav === 'production' ? 'active' : ''}`} onClick={() => setActiveNav('production')}><Factory size={18} /><span>Production</span></button>
          <div className="rail-spacer" />
          <button className="rail-button"><Settings2 size={18} /><span>Settings</span></button>
        </aside>

        <aside className="side-panel left-panel">
          {activeNav === 'search' && <SearchPanel searchText={searchText} setSearchText={setSearchText} onRun={handleCommand} />}
          {activeNav === 'layers' && <LayersPanel viewMode={viewMode} placeName={request.place} districtScope={districtScope} scopeLabel={districtLabel} hiddenLayers={hiddenLayers} onView={handleTab} onToggle={toggleLayer} featureCount={visibleFeatureCount} />}
          <Suspense fallback={<div className="panel-content panel-loading">Loading module…</div>}>
          {activeNav === 'data' && <DataBindingPanel rows={dataRows} features={activeFeatures} years={years} currentYear={currentYear} result={visualization} sources={filteredSources} onRowsChange={setDataRows} onYearChange={setCurrentYear} onToast={setNotice} />}
          {activeNav === 'infographics' && <InfographicsPanel onUse={handleInfographicTemplate} />}
          {activeNav === 'templates' && <TemplatesPanel onUse={handleTemplate} />}
          {activeNav === 'filters' && <FiltersPanel filters={filters} onRemove={removeFilter} />}
          {activeNav === 'saved' && <SavedPanel title={infographicConfig.title || canvasTitle} rows={dataRows.length} annotations={annotations.length} onSave={() => { localStorage.setItem('map-studio-infographic-v1', JSON.stringify({ rows: dataRows, config: infographicConfig, annotations, currentYear })); markSaved(); }} onRestore={restoreProject} onToast={setNotice} />}
          {activeNav === 'video' && <PixelVideoPanel map={mapInstance} viewMode={viewMode} active={pixelVideoActive} years={years} currentYear={currentYear} title={infographicConfig.title || canvasTitle} source={infographicConfig.source} onYearChange={setCurrentYear} onActiveChange={setPixelVideoActive} onToast={setNotice} />}
          {activeNav === 'export' && <ExportPanel map={mapInstance} config={infographicConfig} legend={visualization.legend} annotations={annotations} rows={dataRows} currentYear={currentYear} fileStem={canvasTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map-infographic'} onToast={setNotice} />}
          </Suspense>
          {activeNav === 'production' && <ProductionPanel templateId={activeInfographic?.id ?? 'custom-map'} viewMode={viewMode} onToast={setNotice} />}
        </aside>

        <main className="main-canvas">
          <div className="command-row">
            <div className="command-input-wrap">
              <Sparkles size={17} className="command-icon" />
              <input value={commandText} onChange={(event) => setCommandText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && commandText.trim()) handleCommand(commandText.trim()); }} placeholder="Describe a map or edit the current view…" aria-label="AI map command" />
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
              <button className="outline-button" onClick={() => setNotice('Interactive share link ready to configure')}><Share2 size={15} /> Share</button>
              <button className="outline-button pixel-video-action" onClick={() => setActiveNav('video')}><Video size={15} /> Pixel video</button>
              <button className="primary-button" onClick={() => { markSaved(); setActiveNav('export'); }}><Download size={15} /> Export</button>
            </div>
          </div>

          <div className={`map-frame aspect-${infographicConfig.aspect.replace(':', '-')} ${pixelVideoActive ? 'pixel-video-active' : ''}`} style={{ background: infographicConfig.background }}>
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
              <span className="map-tabs-divider" />
              <span className="map-scale-label">{scaleLabelForView(viewMode, featureCount, districtLabel)}</span>
            </div>
            <MapCanvas viewMode={viewMode} selectedIds={selectedIds} hiddenLayers={hiddenLayers} style={style} focusPlace={focusPlace} placeContext={request.parentGeography} districtScope={districtScope} districtScopeLabel={districtLabel} onSelect={handleSelect} onLoad={setFeatureCount} onMapReady={setMapInstance} dataVisuals={dataVisuals} infographicConfig={infographicConfig} onFeatures={(features, loadedViewMode) => { setActiveFeatures(features); setActiveFeatureViewMode(loadedViewMode); }} />
            {infographicConfig.showTitle && <div className="infographic-title-overlay"><h2>{infographicConfig.title || currentTitle}</h2>{infographicConfig.subtitle && <p>{infographicConfig.subtitle}</p>}{currentYear && <span>{currentYear}</span>}</div>}
            <AnnotationLayer annotations={annotations} editable={editorMode === 'editor'} onChange={setAnnotations} />
            {pixelVideoActive && <div className="pixel-video-overlay" aria-hidden="true" />}
            {infographicConfig.showLegend && <div className="map-legend">
              <div className="legend-title">{dataRows.length ? 'Legend' : isPoliticalLevel ? 'Boundary source' : 'Map context'}</div>
              {dataRows.length ? visualization.legend.map((item) => <div className="legend-row" key={`${item.color}-${item.label}`}><span className="legend-swatch" style={{ background: item.color }} /> {item.label}</div>) : <><div className="legend-row"><span className="legend-swatch selected" /> Selected region</div>
              {viewMode === 'jammu-kashmir' ? <>
                <div className="legend-row"><span className="legend-swatch" style={{ background: '#f4c542' }} /> Jammu and Kashmir districts</div>
                <div className="legend-row"><span className="legend-swatch" style={{ background: '#7ce8eb' }} /> Ladakh official outline</div>
              </> : <div className="legend-row"><span className="legend-swatch" style={{ background: style.fill }} /> {legendLabelForView(viewMode, currentTitle)}</div>}</>}
              <div className="legend-source"><span className="status-dot" /> {dataRows.length ? `${visualization.matchedRows}/${visualization.totalRows} rows matched` : sourceLabelForView(viewMode, districtScope, focusPlace)}</div>
            </div>}
            {infographicConfig.showSource && <div className="infographic-source-overlay">{infographicConfig.source}</div>}
            {isPoliticalLevel && !dataRows.length && <div className="map-data-callout"><div className="callout-icon"><Database size={15} /></div><div><strong>Political results not connected</strong><span>Bind an election dataset to color by winner, turnout, or margin.</span></div><button onClick={() => setActiveNav('data')} aria-label="Open data panel"><ArrowUpRight size={15} /></button></div>}
          </div>

          <div className="canvas-footer"><span><span className="status-dot" /> Auto-save enabled</span><span>·</span><span>Source-backed geometry</span><span>·</span><span>Attribution included</span></div>
        </main>

        <aside className="side-panel right-panel">
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
