import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSpec } from '../domain/charts';
import { DEFAULT_COMPOSITION_ID } from '../domain/composition';
import type { DatasetMeta, RegionOverrides } from '../domain/dataSources';
import type { Annotation, DataRow, InfographicConfig } from '../domain/infographic';
import {
  createProject,
  duplicateProject,
  projectFromDocument,
  loadBrandKits,
  loadProjectStore,
  pushVersion,
  restoreVersion,
  saveProjectStore,
  type BrandKit,
  type Project,
  type ProjectRole,
} from '../domain/projects';
import type { MapGeography, MapPresentation, ProjectDocument } from '../domain/projectDocument';
import type { VideoSpec } from '../domain/videoTimeline';
import type { FilterSpec, ViewMode } from '../domain/types';

const AUTOSAVE_DELAY_MS = 1_200;
/** A version snapshot is kept at most this often, so autosave cannot flood history. */
const VERSION_INTERVAL_MS = 120_000;

export type StudioProjectApi = {
  project: Project;
  projects: Project[];
  brandKits: BrandKit[];
  role: ProjectRole;
  saveState: 'saved' | 'saving' | 'dirty';
  patch: (patch: Partial<Project>) => void;
  patchConfig: (patch: Partial<InfographicConfig>) => void;
  patchDatasetMeta: (patch: Partial<DatasetMeta>) => void;
  setRows: (rows: DataRow[], meta?: Partial<DatasetMeta>) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  setChartOverride: (blockId: string, patch: Partial<ChartSpec>) => void;
  resetChartOverrides: () => void;
  setRegionOverride: (from: string, to: string) => void;
  setGeography: (patch: Partial<MapGeography>) => void;
  setPresentation: (patch: Partial<MapPresentation>) => void;
  setVideoSpec: (patch: Partial<VideoSpec>) => void;
  setFilters: (filters: FilterSpec[]) => void;
  open: (projectId: string) => void;
  create: (name: string) => void;
  /** Adopts a document fetched from the server as a new active project. */
  adoptDocument: (document: ProjectDocument, name?: string) => void;
  duplicate: () => void;
  setArchived: (projectId: string, archived: boolean) => void;
  saveVersion: (label: string) => void;
  restore: (versionId: string) => void;
  applyBrandKitById: (kitId: string) => void;
};

export function useStudioProject(role: ProjectRole = 'owner', seed?: Partial<Project>): StudioProjectApi {
  const storage = typeof window === 'undefined' ? undefined : window.localStorage;
  const [brandKits] = useState<BrandKit[]>(() => (storage ? loadBrandKits(storage) : []));
  const [projects, setProjects] = useState<Project[]>(() => {
    const loaded = storage ? loadProjectStore(storage) : { projects: [] as Project[] };
    if (loaded.projects.length) return loaded.projects;
    return [createProject('Untitled project', { compositionId: DEFAULT_COMPOSITION_ID, ...seed })];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const loaded = storage ? loadProjectStore(storage) : { projects: [] as Project[], activeId: undefined };
    return loaded.activeId && loaded.projects.some((entry) => entry.id === loaded.activeId) ? loaded.activeId : '';
  });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const lastVersionAt = useRef(Date.now());
  const firstRender = useRef(true);

  const project = useMemo(
    () => projects.find((entry) => entry.id === activeId) ?? projects[0],
    [activeId, projects],
  );

  useEffect(() => {
    if (!activeId && project) setActiveId(project.id);
  }, [activeId, project]);

  // Debounced autosave. Read-only viewers never write back.
  useEffect(() => {
    if (!storage || role === 'viewer') return undefined;
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      setSaveState(saveProjectStore(storage, { projects, activeId: project?.id }) ? 'saved' : 'dirty');
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [projects, project?.id, role, storage]);

  /**
   * Applies a mutation to the active project. A mutator that returns the project
   * unchanged is a no-op: without this, high-frequency writes such as map
   * navigation would allocate a new object every render and loop forever.
   */
  const mutate = useCallback((mutator: (current: Project) => Project) => {
    setProjects((current) => {
      const targetId = activeId || current[0]?.id;
      let changed = false;
      const next = current.map((entry) => {
        if (entry.id !== targetId) return entry;
        const mutated = mutator(entry);
        if (mutated === entry) return entry;
        changed = true;
        return touch(mutated);
      });
      return changed ? next : current;
    });
  }, [activeId]);

  const patch = useCallback((change: Partial<Project>) => mutate((current) => ({ ...current, ...change })), [mutate]);

  const patchConfig = useCallback((change: Partial<InfographicConfig>) => {
    mutate((current) => ({ ...current, config: { ...current.config, ...change } }));
  }, [mutate]);

  const patchDatasetMeta = useCallback((change: Partial<DatasetMeta>) => {
    mutate((current) => ({ ...current, datasetMeta: { ...current.datasetMeta, ...change } }));
  }, [mutate]);

  const setRows = useCallback((rows: DataRow[], meta: Partial<DatasetMeta> = {}) => {
    mutate((current) => {
      // Snapshot before a big data change, but no more than once per interval.
      const shouldSnapshot = Date.now() - lastVersionAt.current > VERSION_INTERVAL_MS && current.rows.length > 0;
      if (shouldSnapshot) lastVersionAt.current = Date.now();
      const base = shouldSnapshot ? pushVersion(current, 'Autosave') : current;
      return { ...base, rows, datasetMeta: { ...base.datasetMeta, rowCount: rows.length, ...meta } };
    });
  }, [mutate]);

  const setAnnotations = useCallback((annotations: Annotation[]) => mutate((current) => ({ ...current, annotations })), [mutate]);

  const setChartOverride = useCallback((blockId: string, change: Partial<ChartSpec>) => {
    mutate((current) => ({ ...current, chartOverrides: { ...current.chartOverrides, [blockId]: { ...current.chartOverrides[blockId], ...change } } }));
  }, [mutate]);

  const resetChartOverrides = useCallback(() => mutate((current) => ({ ...current, chartOverrides: {} })), [mutate]);

  const setRegionOverride = useCallback((from: string, to: string) => {
    mutate((current) => ({ ...current, regionOverrides: { ...current.regionOverrides, [from]: to } }));
  }, [mutate]);

  /**
   * Geography writes are frequent (every map navigation), so they skip the
   * version snapshot and only touch the fields that actually changed.
   */
  const setGeography = useCallback((change: Partial<MapGeography>) => {
    mutate((current) => {
      const next = { ...current.geography, ...change };
      const unchanged = next.viewMode === current.geography.viewMode
        && next.districtScope === current.geography.districtScope
        && next.focusPlace === current.geography.focusPlace
        && next.placeContext === current.geography.placeContext
        && sameIds(next.selectedIds, current.geography.selectedIds);
      return unchanged ? current : { ...current, geography: next };
    });
  }, [mutate]);

  const setPresentation = useCallback((change: Partial<MapPresentation>) => {
    mutate((current) => {
      const next: MapPresentation = {
        style: { ...current.presentation.style, ...change.style },
        hiddenLayers: change.hiddenLayers ?? current.presentation.hiddenLayers,
      };
      return sameJson(next, current.presentation) ? current : { ...current, presentation: next };
    });
  }, [mutate]);

  const setVideoSpec = useCallback((change: Partial<VideoSpec>) => {
    mutate((current) => {
      const next = { ...current.videoSpec, ...change };
      return sameJson(next, current.videoSpec) ? current : { ...current, videoSpec: next };
    });
  }, [mutate]);

  const setFilters = useCallback((filters: FilterSpec[]) => {
    mutate((current) => (sameJson(filters, current.filters) ? current : { ...current, filters }));
  }, [mutate]);

  const open = useCallback((projectId: string) => setActiveId(projectId), []);

  const create = useCallback((name: string) => {
    const next = createProject(name);
    setProjects((current) => [next, ...current]);
    setActiveId(next.id);
  }, []);

  const adoptDocument = useCallback((document: ProjectDocument, name?: string) => {
    const next = projectFromDocument(document, name ? { name } : {});
    setProjects((current) => [next, ...current]);
    setActiveId(next.id);
  }, []);

  const duplicate = useCallback(() => {
    if (!project) return;
    const copy = duplicateProject(project);
    setProjects((current) => [copy, ...current]);
    setActiveId(copy.id);
  }, [project]);

  const setArchived = useCallback((projectId: string, archived: boolean) => {
    setProjects((current) => current.map((entry) => (entry.id === projectId ? { ...entry, archived, updatedAt: new Date().toISOString() } : entry)));
  }, []);

  const saveVersion = useCallback((label: string) => {
    lastVersionAt.current = Date.now();
    mutate((current) => pushVersion(current, label));
  }, [mutate]);

  const restore = useCallback((versionId: string) => mutate((current) => restoreVersion(current, versionId)), [mutate]);

  const applyBrandKitById = useCallback((kitId: string) => {
    const kit = brandKits.find((entry) => entry.id === kitId);
    if (!kit) return;
    mutate((current) => ({ ...current, brandKitId: kit.id, config: { ...current.config, customColors: kit.colors } }));
  }, [brandKits, mutate]);

  return {
    project,
    projects,
    brandKits,
    role,
    saveState,
    patch,
    patchConfig,
    patchDatasetMeta,
    setRows,
    setAnnotations,
    setChartOverride,
    resetChartOverrides,
    setRegionOverride,
    setGeography,
    setPresentation,
    setVideoSpec,
    setFilters,
    open,
    create,
    adoptDocument,
    duplicate,
    setArchived,
    saveVersion,
    restore,
    applyBrandKitById,
  };
}

/** Cheap structural comparison for the small settings objects written on navigation. */
function sameJson(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function sameIds(first: string[], second: string[]) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function projectViewMode(project: Project): ViewMode {
  return project.geography.viewMode;
}
