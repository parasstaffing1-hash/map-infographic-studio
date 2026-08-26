import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSpec } from '../domain/charts';
import { DEFAULT_COMPOSITION_ID } from '../domain/composition';
import type { DatasetMeta, RegionOverrides } from '../domain/dataSources';
import type { Annotation, DataRow, InfographicConfig } from '../domain/infographic';
import {
  createProject,
  duplicateProject,
  loadBrandKits,
  loadProjectStore,
  pushVersion,
  restoreVersion,
  saveProjectStore,
  type BrandKit,
  type Project,
  type ProjectRole,
} from '../domain/projects';
import type { ViewMode } from '../domain/types';

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
  open: (projectId: string) => void;
  create: (name: string) => void;
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

  const mutate = useCallback((mutator: (current: Project) => Project) => {
    setProjects((current) => current.map((entry) => (entry.id === (activeId || current[0]?.id) ? touch(mutator(entry)) : entry)));
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

  const open = useCallback((projectId: string) => setActiveId(projectId), []);

  const create = useCallback((name: string) => {
    const next = createProject(name);
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
    open,
    create,
    duplicate,
    setArchived,
    saveVersion,
    restore,
    applyBrandKitById,
  };
}

function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function projectViewMode(project: Project): ViewMode {
  return project.viewMode;
}
