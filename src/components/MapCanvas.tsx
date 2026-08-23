import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import { JAMMU_KASHMIR_STATE_OUTLINE_URL, OFFICIAL_INDIA_OUTLINE_URL, featureToEntity, loadFeatures } from '../domain/data';
import type { InfographicConfig, VisualDatum } from '../domain/infographic';
import type { GeoFeature, GeoFeatureCollection, ResolvedEntity, StyleSpec, ViewMode } from '../domain/types';

type Props = {
  viewMode: ViewMode;
  selectedIds: string[];
  hiddenLayers: Record<string, boolean>;
  style: StyleSpec;
  focusPlace?: string;
  placeContext?: string;
  districtScope?: string;
  districtScopeLabel?: string;
  onSelect: (entity: ResolvedEntity, feature: GeoFeature) => void;
  onLoad?: (count: number) => void;
  onMapReady?: (map: MapLibreMap | null) => void;
  dataVisuals?: Record<string, VisualDatum>;
  infographicConfig?: InfographicConfig;
  onFeatures?: (features: GeoFeature[], viewMode: ViewMode) => void;
};

type PlaceResult = {
  coordinates: [number, number];
  zoom: number;
  label: string;
  geometry?: GeoFeature['geometry'];
};

const EMPTY_STYLE = {
  version: 8 as const,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#edf2f8' } },
    { id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-opacity': 0.46, 'raster-saturation': -0.65, 'raster-contrast': -0.08 } },
  ],
};

const JK_DISTRICT_FILL = '#f4c542';
const LADAKH_FILL = '#7ce8eb';
const JK_BOUNDARY = '#80652b';
const JK_LABEL = '#4d432e';

const officialUtFill = ['case', ['==', ['get', 'NAME_1'], 'Ladakh'], LADAKH_FILL, JK_DISTRICT_FILL] as any;
function entityFillColor(viewMode: ViewMode, fill: string) {
  if (viewMode === 'jammu-kashmir') return ['case', ['boolean', ['feature-state', 'selected'], false], '#d9a51c', ['boolean', ['feature-state', 'hover'], false], '#f8dc77', ['coalesce', ['get', '__dataColor'], JK_DISTRICT_FILL]] as any;
  return ['case', ['boolean', ['feature-state', 'selected'], false], '#f6b44d', ['boolean', ['feature-state', 'hover'], false], '#8998ee', ['coalesce', ['get', '__dataColor'], fill]] as any;
}

function entityFillOpacity(viewMode: ViewMode, opacity: number) {
  if (viewMode === 'jammu-kashmir') return ['case', ['boolean', ['feature-state', 'selected'], false], 0.96, ['coalesce', ['get', '__dataOpacity'], 0.9]] as any;
  return ['case', ['has', '__official'], Math.min(opacity + 0.28, 0.94), ['boolean', ['feature-state', 'selected'], false], 0.94, ['coalesce', ['get', '__dataOpacity'], opacity]] as any;
}

function entityLineColor(viewMode: ViewMode, line: string) {
  if (viewMode === 'jammu-kashmir') return JK_BOUNDARY;
  return line;
}

function entityLineWidth(viewMode: ViewMode, lineWidth: number) {
  if (viewMode === 'jammu-kashmir') return 0.82;
  return lineWidth;
}

export function MapCanvas({ viewMode, selectedIds, hiddenLayers, style, focusPlace, placeContext, districtScope, districtScopeLabel, onSelect, onLoad, onMapReady, dataVisuals = {}, infographicConfig, onFeatures }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const featuresRef = useRef<GeoFeatureCollection>({ type: 'FeatureCollection', features: [] });
  const baseFeaturesRef = useRef<GeoFeatureCollection>({ type: 'FeatureCollection', features: [] });
  const officialOutlineRef = useRef<GeoFeatureCollection | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const loadVersionRef = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: EMPTY_STYLE,
      center: [79.3, 30.2],
      zoom: 6,
      attributionControl: false,
      preserveDrawingBuffer: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('error', (event) => {
      if (event.error?.message?.includes('tile')) return;
      setErrorMessage(event.error?.message ?? 'Map renderer error');
    });
    mapRef.current = map;
    onMapReady?.(map);
    return () => {
      map.remove();
      mapRef.current = null;
      onMapReady?.(null);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const loadVersion = loadVersionRef.current + 1;
    loadVersionRef.current = loadVersion;
    let cancelled = false;
    const isCurrentLoad = () => !cancelled && loadVersion === loadVersionRef.current;
    setStatus('loading');
    const sourceViewMode = viewMode === 'india-districts' && districtScope === 'NCTofDelhi' ? 'delhi-districts' : viewMode;
    Promise.all([loadFeatures(sourceViewMode), loadOfficialOutline(viewMode, districtScope)])
      .then(([collection, officialOutline]) => {
        if (!isCurrentLoad()) return;
        const activeCollection = filterToScope(collection, sourceViewMode, districtScope);
        baseFeaturesRef.current = activeCollection;
        officialOutlineRef.current = officialOutline;
        const decoratedCollection = decorateCollection(activeCollection, dataVisuals, infographicConfig);
        featuresRef.current = decoratedCollection;
        onFeatures?.(activeCollection.features, viewMode);
        const install = () => {
          if (!isCurrentLoad()) return;
          if (!map.isStyleLoaded()) return;
          if (map.getLayer('entity-fill')) map.removeLayer('entity-fill');
          if (map.getLayer('entity-points')) map.removeLayer('entity-points');
          if (map.getLayer('entity-outline')) map.removeLayer('entity-outline');
          if (map.getLayer('entity-label')) map.removeLayer('entity-label');
          if (map.getLayer('jammu-kashmir-state-fill')) map.removeLayer('jammu-kashmir-state-fill');
          if (map.getLayer('jammu-kashmir-state-label')) map.removeLayer('jammu-kashmir-state-label');
          if (map.getLayer('india-official-fill')) map.removeLayer('india-official-fill');
          if (map.getLayer('india-official-outline')) map.removeLayer('india-official-outline');
          if (map.getLayer('jammu-kashmir-state-outline')) map.removeLayer('jammu-kashmir-state-outline');
          if (map.getLayer('district-context')) map.removeLayer('district-context');
          if (map.getSource('active-entities')) map.removeSource('active-entities');
          if (map.getSource('jammu-kashmir-state-outline')) map.removeSource('jammu-kashmir-state-outline');
          if (map.getSource('india-official-outline')) map.removeSource('india-official-outline');
          if (map.getSource('district-context')) map.removeSource('district-context');

          // A place request is a geocoded point/context view, not a boundary
          // collection. Mark it ready here so the marker effect can render.
          if (viewMode === 'place') {
            setStatus('ready');
            onLoad?.(0);
            return;
          }

          if (viewMode === 'jammu-kashmir') {
            map.addSource('jammu-kashmir-state-outline', { type: 'geojson', data: JAMMU_KASHMIR_STATE_OUTLINE_URL });
            map.addLayer({
              id: 'jammu-kashmir-state-fill',
              type: 'fill',
              source: 'jammu-kashmir-state-outline',
              paint: {
                'fill-color': officialUtFill,
                'fill-opacity': 0.82,
              },
            });
          }
          const mapCollection = officialOutline
            ? { ...decoratedCollection, features: [...officialOutline.features.map((feature, index) => ({ ...feature, id: `india-official-${index}`, properties: { ...feature.properties, __name: '', __label: '', __official: true } })), ...decoratedCollection.features] }
            : decoratedCollection;
          map.addSource('active-entities', { type: 'geojson', data: mapCollection as never });
          map.addLayer({
            id: 'entity-fill', type: 'fill', source: 'active-entities',
            paint: {
              'fill-color': entityFillColor(viewMode, style.fill),
              'fill-opacity': entityFillOpacity(viewMode, style.opacity),
            },
          });
          if (viewMode === 'cities') {
            map.addLayer({ id: 'entity-points', type: 'circle', source: 'active-entities', paint: { 'circle-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#f6b44d', style.fill], 'circle-radius': ['interpolate', ['linear'], ['get', 'population'], 100000, 4, 4500000, 18], 'circle-opacity': 0.82, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
          }
          map.addLayer({
            id: 'entity-outline',
            type: 'line',
            source: 'active-entities',
            paint: {
              'line-color': entityLineColor(viewMode, style.line),
              'line-width': entityLineWidth(viewMode, style.lineWidth),
              'line-opacity': viewMode === 'jammu-kashmir' ? 0.86 : 0.92,
            },
          });
          if (viewMode === 'jammu-kashmir') {
            map.addLayer({
              id: 'jammu-kashmir-state-outline',
              type: 'line',
              source: 'jammu-kashmir-state-outline',
              paint: {
                'line-color': viewMode === 'jammu-kashmir' ? JK_BOUNDARY : '#ffffff',
                'line-width': viewMode === 'jammu-kashmir' ? 1.1 : 2.4,
                'line-opacity': viewMode === 'jammu-kashmir' ? 0.92 : 0.98,
              },
            });
          }
          if (viewMode === 'jammu-kashmir') {
            map.addLayer({
              id: 'jammu-kashmir-state-label',
              type: 'symbol',
              source: 'jammu-kashmir-state-outline',
              layout: {
                'text-field': ['get', '__name'],
                'text-size': 11,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-letter-spacing': 0.12,
              },
              paint: { 'text-color': JK_LABEL, 'text-halo-color': '#fff8df', 'text-halo-width': 1.2 },
            });
          }
          map.addLayer({ id: 'entity-label', type: 'symbol', source: 'active-entities', layout: { 'text-field': ['coalesce', ['get', '__label'], ['get', '__name']], 'text-size': 10, 'text-allow-overlap': false }, paint: { 'text-color': '#24324a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
          const isScopedIndiaElection = (viewMode === 'india-assembly' || viewMode === 'india-parliament') && Boolean(districtScope);
          const isScopedUsElection = (viewMode === 'usa-state-house' || viewMode === 'usa-congress') && Boolean(districtScope);
          const contextView = viewMode === 'delhi-assembly' || isScopedIndiaElection && districtScope === 'NCTofDelhi' ? 'delhi-districts' : isScopedIndiaElection ? 'india-districts' : isScopedUsElection ? 'usa-counties' : viewMode === 'state' || viewMode === 'assembly' ? 'district' : null;
          if (contextView) {
            loadFeatures(contextView).then((districts) => {
              if (!isCurrentLoad() || !map.isStyleLoaded()) return;
              const contextDistricts = filterToScope(districts, contextView, districtScope);
              map.addSource('district-context', { type: 'geojson', data: contextDistricts as never });
              map.addLayer({ id: 'district-context', type: 'line', source: 'district-context', paint: { 'line-color': '#526177', 'line-width': 0.8, 'line-opacity': 0.44, 'line-dasharray': [2, 2] } }, 'entity-outline');
            }).catch(() => undefined);
          }
          const targetFeatures = focusPlace && viewMode === 'world' ? activeCollection.features.filter((feature) => String(feature.properties.__name ?? '').toLowerCase() === focusPlace.toLowerCase()) : activeCollection.features;
          const bbox = targetFeatures.length ? boundsFor(targetFeatures) : activeCollection.features.length ? boundsFor(activeCollection.features) : null;
          if (bbox) map.fitBounds(bbox, { padding: { top: 36, right: 30, bottom: 36, left: 30 }, duration: 650, maxZoom: maxZoomFor(viewMode, districtScope) });
          setStatus('ready');
          onLoad?.(activeCollection.features.length);
        };
        const installWhenReady = () => {
          if (!isCurrentLoad()) return;
          if (map.isStyleLoaded()) install();
          else window.setTimeout(installWhenReady, 50);
        };
        installWhenReady();
      })
      .catch((error: Error) => {
        if (!isCurrentLoad()) return;
        setStatus('error');
        setErrorMessage(error.message);
      });
    return () => { cancelled = true; };
  }, [viewMode, focusPlace, districtScope]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('active-entities');
    if (!map || !source || !('setData' in source) || typeof source.setData !== 'function' || viewMode === 'place') return;
    const decoratedCollection = decorateCollection(baseFeaturesRef.current, dataVisuals, infographicConfig);
    featuresRef.current = decoratedCollection;
    const officialOutline = officialOutlineRef.current;
    const mapCollection = officialOutline
      ? { ...decoratedCollection, features: [...officialOutline.features.map((feature, index) => ({ ...feature, id: `india-official-${index}`, properties: { ...feature.properties, __name: '', __label: '', __official: true } })), ...decoratedCollection.features] }
      : decoratedCollection;
    source.setData(mapCollection as never);
    if (map.getLayer('entity-fill')) {
      map.setPaintProperty('entity-fill', 'fill-color', entityFillColor(viewMode, style.fill));
      map.setPaintProperty('entity-fill', 'fill-opacity', entityFillOpacity(viewMode, style.opacity));
    }
  }, [dataVisuals, infographicConfig, status, style.fill, style.opacity, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('entity-fill')) return;
    map.setPaintProperty('entity-fill', 'fill-color', entityFillColor(viewMode, style.fill));
    map.setPaintProperty('entity-fill', 'fill-opacity', entityFillOpacity(viewMode, style.opacity));
    if (map.getLayer('entity-points')) map.setPaintProperty('entity-points', 'circle-color', ['case', ['boolean', ['feature-state', 'selected'], false], '#f6b44d', style.fill]);
    if (map.getLayer('entity-outline')) {
      map.setPaintProperty('entity-outline', 'line-color', entityLineColor(viewMode, style.line));
      map.setPaintProperty('entity-outline', 'line-width', entityLineWidth(viewMode, style.lineWidth));
      map.setPaintProperty('entity-outline', 'line-opacity', viewMode === 'jammu-kashmir' ? 0.86 : 0.92);
    }
    map.setLayoutProperty('entity-label', 'visibility', hiddenLayers.labels ? 'none' : 'visible');
    if (map.getLayer('jammu-kashmir-state-label')) map.setLayoutProperty('jammu-kashmir-state-label', 'visibility', hiddenLayers.labels ? 'none' : 'visible');
    if (map.getLayer('india-official-fill')) {
      map.setPaintProperty('india-official-fill', 'fill-color', style.fill);
      map.setPaintProperty('india-official-fill', 'fill-opacity', Math.min(style.opacity + 0.28, 0.94));
    }
    if (map.getLayer('india-official-outline')) map.setPaintProperty('india-official-outline', 'line-color', style.line);
    if (map.getLayer('jammu-kashmir-state-fill')) {
      map.setPaintProperty('jammu-kashmir-state-fill', 'fill-color', viewMode === 'jammu-kashmir' ? officialUtFill : style.fill);
      map.setPaintProperty('jammu-kashmir-state-fill', 'fill-opacity', viewMode === 'jammu-kashmir' ? 0.82 : style.opacity);
    }
    if (map.getLayer('jammu-kashmir-state-outline')) {
      map.setPaintProperty('jammu-kashmir-state-outline', 'line-color', viewMode === 'jammu-kashmir' ? JK_BOUNDARY : style.line);
      map.setPaintProperty('jammu-kashmir-state-outline', 'line-width', viewMode === 'jammu-kashmir' ? 1.1 : 2.4);
      map.setPaintProperty('jammu-kashmir-state-outline', 'line-opacity', viewMode === 'jammu-kashmir' ? 0.92 : 0.98);
    }
    if (map.getLayer('district-context')) map.setLayoutProperty('district-context', 'visibility', hiddenLayers.districts ? 'none' : 'visible');
  }, [style, hiddenLayers, status, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (!map.getLayer('entity-fill') && !map.getLayer('entity-points'))) return;
    for (const feature of featuresRef.current.features) {
      const id = String(feature.id);
      map.setFeatureState({ source: 'active-entities', id }, { selected: selectedIds.includes(id) });
    }
  }, [selectedIds, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('entity-fill')) return;
    const clearHover = () => {
      if (hoveredIdRef.current) map.setFeatureState({ source: 'active-entities', id: hoveredIdRef.current }, { hover: false });
      hoveredIdRef.current = null;
      map.getCanvas().style.cursor = '';
    };
    const move = (event: MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point).find((item) => item.source === 'active-entities');
      const nextId = feature?.id === undefined ? null : String(feature.id);
      if (nextId === hoveredIdRef.current) return;
      if (hoveredIdRef.current) map.setFeatureState({ source: 'active-entities', id: hoveredIdRef.current }, { hover: false });
      hoveredIdRef.current = nextId;
      if (nextId) map.setFeatureState({ source: 'active-entities', id: nextId }, { hover: true });
      map.getCanvas().style.cursor = nextId ? 'pointer' : '';
    };
    map.on('mousemove', move);
    map.on('mouseleave', 'entity-fill', clearHover);
    return () => {
      map.off('mousemove', move);
      map.off('mouseleave', 'entity-fill', clearHover);
      clearHover();
    };
  }, [status, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const markerSource = 'place-context';
    const boundarySource = 'place-boundary';
    let cancelled = false;
    const renderMarker = async () => {
      const marker = status === 'ready' && viewMode === 'place' ? (markerForPlace(focusPlace) ?? await officialPlaceBoundary(focusPlace) ?? await geocodePlace(focusPlace, placeContext)) : null;
      if (cancelled) return;
      if (marker) {
        const boundaryFeature = marker.geometry ? { type: 'Feature' as const, geometry: marker.geometry, properties: { label: marker.label } } : null;
        if (boundaryFeature) {
          const boundaryData = { type: 'FeatureCollection' as const, features: [boundaryFeature] };
          if (!map.getSource(boundarySource)) {
            map.addSource(boundarySource, { type: 'geojson', data: boundaryData as never });
            map.addLayer({ id: 'place-boundary-fill', type: 'fill', source: boundarySource, paint: { 'fill-color': style.fill, 'fill-opacity': Math.min(style.opacity + 0.08, 0.86) } });
            map.addLayer({ id: 'place-boundary-outline', type: 'line', source: boundarySource, paint: { 'line-color': style.line, 'line-width': style.lineWidth + 0.4, 'line-opacity': 0.95 } });
          }
          const boundaryLayerSource = map.getSource(boundarySource);
          if (boundaryLayerSource && 'setData' in boundaryLayerSource && typeof boundaryLayerSource.setData === 'function') boundaryLayerSource.setData(boundaryData as never);
        } else {
          removePlaceBoundary(map, boundarySource);
        }
        if (!map.getSource(markerSource)) {
          map.addSource(markerSource, { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: marker.coordinates }, properties: { label: marker.label } }] } as never });
          map.addLayer({ id: 'place-point', type: 'circle', source: markerSource, paint: { 'circle-radius': 7, 'circle-color': '#f6b44d', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
          map.addLayer({ id: 'place-label', type: 'symbol', source: markerSource, layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top' }, paint: { 'text-color': '#684f2c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
        }
        const markerLayerSource = map.getSource(markerSource);
        if (markerLayerSource && 'setData' in markerLayerSource && typeof markerLayerSource.setData === 'function') {
          markerLayerSource.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: marker.coordinates }, properties: { label: marker.label } }] } as never);
        }
        if (boundaryFeature) map.fitBounds(boundsFor([boundaryFeature]), { padding: { top: 36, right: 30, bottom: 36, left: 30 }, duration: 900, maxZoom: marker.zoom });
        else map.flyTo({ center: marker.coordinates, zoom: marker.zoom, duration: 1100 });
      } else {
        removePlaceBoundary(map, boundarySource);
        if (map.getLayer('place-label')) map.removeLayer('place-label');
        if (map.getLayer('place-point')) map.removeLayer('place-point');
        if (map.getLayer('ramnagar-label')) map.removeLayer('ramnagar-label');
        if (map.getLayer('ramnagar-point')) map.removeLayer('ramnagar-point');
        if (map.getSource(markerSource)) map.removeSource(markerSource);
      }
    };
    void renderMarker();
    return () => { cancelled = true; };
  }, [focusPlace, placeContext, status, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const click = (event: MapMouseEvent) => {
      const layers = ['entity-fill', 'entity-points'].filter((layer) => Boolean(map.getLayer(layer)));
      const feature = map.queryRenderedFeatures(event.point, { layers })[0];
      if (!feature) return;
      const renderedName = String(feature.properties?.__name ?? '');
      const original = featuresRef.current.features.find((item) => feature.id !== undefined && String(item.id) === String(feature.id))
        ?? featuresRef.current.features.find((item) => renderedName && String(item.properties.__name ?? '') === renderedName);
      if (original) onSelect(featureToEntity(original), original);
    };
    map.on('click', click);
    return () => {
      map.off('click', click);
    };
  }, [onSelect, status]);

  const openDelhi = () => {
    const delhi = featuresRef.current.features.find((feature) => String(feature.properties.__name ?? '').toLowerCase() === 'nct of delhi');
    if (delhi) onSelect(featureToEntity(delhi), delhi);
  };

  return (
    <div className="map-stage">
      <div ref={containerRef} className="map-canvas" aria-label={`Interactive ${viewMode === 'place' ? focusPlace ?? 'place' : viewMode === 'india' ? 'India states' : viewMode === 'usa' ? 'USA states' : viewMode === 'china' ? 'China provinces' : viewMode === 'india-districts' ? 'India districts' : viewMode === 'india-assembly' ? 'India MLA constituencies' : viewMode === 'india-parliament' ? 'India MP constituencies' : viewMode === 'usa-counties' ? 'USA counties' : viewMode === 'usa-state-house' ? 'USA state legislative districts' : viewMode === 'usa-congress' ? 'USA congressional districts' : viewMode === 'china-prefectures' ? 'China prefectures' : viewMode === 'china-counties' ? 'China counties' : viewMode === 'china-npc' ? 'China NPC administrative units' : viewMode === 'delhi-districts' ? 'Delhi districts' : viewMode === 'delhi-assembly' ? 'Delhi MLA constituencies' : viewMode === 'jammu-kashmir' ? 'Jammu and Kashmir and Ladakh districts' : viewMode} map`} />
      {viewMode === 'india' && status === 'ready' && <button className="india-map-delhi-hit-area" onClick={openDelhi} aria-label="Delhi" />}
      <div className="map-loading" data-state={status}>
        {status === 'loading' && <><span className="spinner" /> Loading source-backed geometry</>}
        {status === 'ready' && <><span className="status-dot" /> Live map canvas</>}
        {status === 'error' && <>Boundary source unavailable · {errorMessage}</>}
      </div>
      <div className="map-overlay-card">
        <span className="eyebrow">OPEN BOUNDARIES</span>
        <strong>{viewMode === 'world' ? 'World countries' : viewMode === 'india' ? 'India · interactive states and Union Territories' : viewMode === 'usa' ? 'USA · interactive states and DC' : viewMode === 'china' ? 'China · interactive provinces' : viewMode === 'india-districts' ? `${districtScopeLabel ?? 'India'} · district-wise map` : viewMode === 'india-assembly' ? `${districtScopeLabel ?? 'India'} · MLA seat map` : viewMode === 'india-parliament' ? `${districtScopeLabel ?? 'India'} · MP seat map` : viewMode === 'usa-counties' ? `${districtScopeLabel ?? 'USA'} · county map` : viewMode === 'usa-state-house' ? `${districtScopeLabel ?? 'USA'} · State House map` : viewMode === 'usa-congress' ? `${districtScopeLabel ?? 'USA'} · Congressional map` : viewMode === 'china-prefectures' ? `${districtScopeLabel ?? 'China'} · prefecture map` : viewMode === 'china-counties' ? `${districtScopeLabel ?? 'China'} · county congress context` : viewMode === 'china-npc' ? `${districtScopeLabel ?? 'China'} · NPC electoral-unit context` : viewMode === 'delhi-districts' ? 'Delhi · published district boundaries' : viewMode === 'delhi-assembly' ? 'Delhi · 70 MLA constituencies' : viewMode === 'jammu-kashmir' ? 'Jammu and Kashmir + Ladakh · official UT map' : viewMode === 'place' ? focusPlace ?? 'Place result' : viewMode === 'cities' ? 'Top 100 cities · 2011' : viewMode === 'assembly' ? 'Assembly constituencies' : viewMode === 'district' ? 'District context' : 'State overview'}</strong>
        <small>{viewMode === 'india' ? 'Click any state or UT to open its districts' : viewMode === 'usa' ? 'Click any state to open its county map' : viewMode === 'china' ? 'Click any province to open its prefecture map' : 'Click a region to inspect its entity record'}</small>
      </div>
    </div>
  );
}

async function loadOfficialOutline(viewMode: ViewMode, districtScope?: string): Promise<GeoFeatureCollection | null> {
  if (viewMode !== 'india' && !((viewMode === 'india-districts' || viewMode === 'india-assembly' || viewMode === 'india-parliament') && !districtScope)) return null;
  const response = await fetch(OFFICIAL_INDIA_OUTLINE_URL);
  if (!response.ok) throw new Error('Could not load the official India boundary');
  return await response.json() as GeoFeatureCollection;
}

async function officialPlaceBoundary(place?: string): Promise<PlaceResult | null> {
  const normalized = place?.trim().toLowerCase();
  const isIndia = normalized === 'india';
  const isJammuKashmir = normalized === 'jammu and kashmir' || normalized === 'jammu & kashmir' || normalized === 'j&k';
  const isLadakh = normalized === 'ladakh';
  if (!isIndia && !isJammuKashmir && !isLadakh) return null;
  try {
    const response = await fetch(isIndia ? OFFICIAL_INDIA_OUTLINE_URL : JAMMU_KASHMIR_STATE_OUTLINE_URL);
    if (!response.ok) return null;
    const collection = await response.json() as GeoFeatureCollection;
    const targetName = isJammuKashmir ? 'Jammu and Kashmir' : isLadakh ? 'Ladakh' : 'India';
    const feature = isIndia
      ? collection.features[0]
      : collection.features.find((item) => String(item.properties.NAME_1 ?? item.properties.__name ?? '') === targetName);
    if (!feature) return null;
    const [[west, south], [east, north]] = boundsFor([feature]);
    return {
      coordinates: [(west + east) / 2, (south + north) / 2],
      zoom: isIndia ? 5.2 : 7,
      label: `${targetName} · official local boundary`,
      geometry: feature.geometry,
    };
  } catch {
    return null;
  }
}

function markerForPlace(place?: string): PlaceResult | null {
  const normalized = place?.toLowerCase();
  if (normalized === 'ramnagar') return { coordinates: [79.126934, 29.394835] as [number, number], zoom: 10.4, label: 'Ramnagar · OSM place record' };
  if (normalized === 'new york city' || normalized === 'nyc') return { coordinates: [-74.0060152, 40.7127281] as [number, number], zoom: 10.2, label: 'New York City · OSM place record' };
  return null;
}

async function geocodePlace(place?: string, context?: string): Promise<PlaceResult | null> {
  if (!place) return null;
  try {
    const query = context ? `${place}, ${context}` : place;
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1&q=${encodeURIComponent(query)}`);
    if (!response.ok) return null;
    const results = await response.json() as Array<{ lat?: string; lon?: string; display_name?: string; geojson?: GeoFeature['geometry'] }>;
    const result = results[0];
    if (!result?.lat || !result.lon) return null;
    return { coordinates: [Number(result.lon), Number(result.lat)] as [number, number], zoom: result.geojson ? 10 : 11, label: `${place} · OSM place record`, geometry: result.geojson };
  } catch {
    return null;
  }
}

function removePlaceBoundary(map: MapLibreMap, sourceId: string) {
  if (map.getLayer('place-boundary-outline')) map.removeLayer('place-boundary-outline');
  if (map.getLayer('place-boundary-fill')) map.removeLayer('place-boundary-fill');
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function boundsFor(features: GeoFeature[]): [[number, number], [number, number]] {
  const bounds = { minLongitude: Infinity, minLatitude: Infinity, maxLongitude: -Infinity, maxLatitude: -Infinity };
  for (const feature of features) extendBounds(feature.geometry.coordinates, bounds);
  return [[bounds.minLongitude, bounds.minLatitude], [bounds.maxLongitude, bounds.maxLatitude]];
}

function filterToScope(collection: GeoFeatureCollection, viewMode: ViewMode, districtScope?: string): GeoFeatureCollection {
  if (!districtScope) return collection;
  if (viewMode === 'india-districts') return { ...collection, features: collection.features.filter((feature) => String(feature.properties.NAME_1 ?? '') === districtScope) };
  if (viewMode === 'india-assembly' || viewMode === 'india-parliament') return { ...collection, features: collection.features.filter((feature) => String(feature.properties.STATE_SCOPE ?? '') === districtScope) };
  if (viewMode.startsWith('usa-') || viewMode.startsWith('china-')) return { ...collection, features: collection.features.filter((feature) => String(feature.properties.SCOPE_CODE ?? '') === districtScope) };
  return collection;
}

function decorateCollection(collection: GeoFeatureCollection, visuals: Record<string, VisualDatum>, config?: InfographicConfig): GeoFeatureCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const id = String(feature.id);
      const visual = visuals[id];
      const name = String(feature.properties.__name ?? '');
      const value = visual?.formattedValue ?? visual?.category ?? '';
      const label = config?.labelMode === 'none' ? ''
        : config?.labelMode === 'value' ? value
          : config?.labelMode === 'both' ? `${name}${value ? `\n${value}` : ''}`
            : name;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          __label: label,
          ...(visual ? {
            __dataColor: visual.color,
            __dataOpacity: visual.opacity,
            __dataValue: visual.formattedValue ?? visual.value ?? visual.category ?? '',
            __hasData: visual.hasData,
          } : {}),
        },
      };
    }),
  };
}

function maxZoomFor(viewMode: ViewMode, districtScope?: string) {
  if (viewMode === 'world' || viewMode === 'usa' || viewMode === 'china') return 4.8;
  if (viewMode === 'india') return 5.6;
  if (viewMode === 'india-districts') return districtScope === 'NCTofDelhi' ? 10 : districtScope ? 9 : 5.6;
  if (viewMode === 'india-assembly' || viewMode === 'india-parliament') return districtScope === 'NCTofDelhi' ? 10 : districtScope ? 9 : 5.8;
  if (viewMode.startsWith('usa-')) return districtScope ? 8.5 : 4.8;
  if (viewMode.startsWith('china-')) return districtScope ? 8.2 : 5;
  if (viewMode === 'cities') return 5.4;
  if (viewMode === 'delhi-districts' || viewMode === 'delhi-assembly') return 10;
  return viewMode === 'assembly' ? 8 : 7;
}

function extendBounds(value: unknown, bounds: { minLongitude: number; minLatitude: number; maxLongitude: number; maxLatitude: number }) {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
    bounds.minLongitude = Math.min(bounds.minLongitude, value[0]);
    bounds.minLatitude = Math.min(bounds.minLatitude, value[1]);
    bounds.maxLongitude = Math.max(bounds.maxLongitude, value[0]);
    bounds.maxLatitude = Math.max(bounds.maxLatitude, value[1]);
    return;
  }
  if (Array.isArray(value)) value.forEach((child) => extendBounds(child, bounds));
}
