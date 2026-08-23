import { create } from 'zustand';
import { createMapRequest } from '../domain/mapRequest';
import { parseEditorCommand, parseMapRequest, viewModeFromRequest } from '../domain/parser';
import type { EditorCommand, EditorMode, FilterSpec, MapRequest, StyleSpec, ViewMode } from '../domain/types';

const initialRequest = parseMapRequest('Make a map of India');

type Snapshot = {
  viewMode: ViewMode;
  editorMode: EditorMode;
  selectedIds: string[];
  hiddenLayers: Record<string, boolean>;
  style: StyleSpec;
  filters: FilterSpec[];
};

type MapStudioState = Snapshot & {
  request: MapRequest;
  commandText: string;
  saveState: 'saved' | 'saving' | 'unsaved';
  history: Snapshot[];
  future: Snapshot[];
  setCommandText: (value: string) => void;
  runCommand: (value: string) => EditorCommand | null;
  applyCommand: (command: EditorCommand) => void;
  setRequest: (request: MapRequest) => void;
  setEditorMode: (mode: EditorMode) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleLayer: (layer: string) => void;
  setSelection: (ids: string[]) => void;
  setStyle: (patch: Partial<StyleSpec>) => void;
  addFilter: (filter: FilterSpec) => void;
  removeFilter: (id: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
};

const initialSnapshot: Snapshot = {
  viewMode: viewModeFromRequest(initialRequest),
  editorMode: 'editor',
  selectedIds: [],
  hiddenLayers: { roads: true, districts: false, labels: false },
  style: { fill: '#6479e8', line: '#ffffff', opacity: 0.66, lineWidth: 1.4, labelField: 'name', theme: 'light' },
  filters: [],
};

function snapshot(state: MapStudioState): Snapshot {
  return {
    viewMode: state.viewMode,
    editorMode: state.editorMode,
    selectedIds: state.selectedIds,
    hiddenLayers: state.hiddenLayers,
    style: state.style,
    filters: state.filters,
  };
}

export const useMapStudio = create<MapStudioState>((set, get) => {
  const commit = (mutate: (state: Snapshot) => Snapshot) => {
    set((state) => {
      const current = snapshot(state);
      return { ...mutate(state), history: [...state.history, current].slice(-50), future: [], saveState: 'unsaved' };
    });
  };

  return {
    ...initialSnapshot,
    request: initialRequest,
    commandText: '',
    saveState: 'saved',
    history: [],
    future: [],
    setCommandText: (value) => set({ commandText: value }),
    runCommand: (value) => {
      const parsedEditor = parseEditorCommand(value);
      const parsedRequest = parseMapRequest(value);
      set({ request: parsedRequest, viewMode: viewModeFromRequest(parsedRequest) });
      if (parsedEditor) get().applyCommand(parsedEditor);
      set({ commandText: value });
      return parsedEditor;
    },
    applyCommand: (command) => {
      switch (command.type) {
        case 'set-view':
          commit((state) => ({ ...state, viewMode: command.viewMode }));
          break;
        case 'set-layer':
          commit((state) => ({ ...state, hiddenLayers: { ...state.hiddenLayers, [command.layer]: !command.visible } }));
          break;
        case 'select-color':
          commit((state) => ({ ...state, style: { ...state.style, fill: command.color } }));
          break;
        case 'set-filter':
          commit((state) => ({ ...state, filters: [...state.filters.filter((item) => item.id !== command.filter.id), command.filter] }));
          break;
        case 'presentation-ready':
          commit((state) => ({ ...state, style: { ...state.style, opacity: 0.78, lineWidth: 1.8 }, hiddenLayers: { ...state.hiddenLayers, roads: true, labels: true } }));
          break;
        case 'fit-place':
          set({ commandText: command.place });
          break;
        case 'export':
          set({ saveState: 'saved' });
          break;
      }
    },
    setRequest: (request) => set({ request, viewMode: viewModeFromRequest(request), saveState: 'unsaved' }),
    setEditorMode: (editorMode) => set({ editorMode }),
    setViewMode: (viewMode) => commit((state) => ({ ...state, viewMode })),
    toggleLayer: (layer) => commit((state) => ({ ...state, hiddenLayers: { ...state.hiddenLayers, [layer]: !state.hiddenLayers[layer] } })),
    setSelection: (selectedIds) => set({ selectedIds }),
    setStyle: (patch) => commit((state) => ({ ...state, style: { ...state.style, ...patch } })),
    addFilter: (filter) => commit((state) => ({ ...state, filters: [...state.filters, filter] })),
    removeFilter: (id) => commit((state) => ({ ...state, filters: state.filters.filter((filter) => filter.id !== id) })),
    undo: () => set((state) => {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return { ...previous, request: state.request, commandText: state.commandText, saveState: 'unsaved', history: state.history.slice(0, -1), future: [snapshot(state), ...state.future] };
    }),
    redo: () => set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return { ...next, request: state.request, commandText: state.commandText, saveState: 'unsaved', history: [...state.history, snapshot(state)], future: state.future.slice(1) };
    }),
    markSaved: () => set({ saveState: 'saved' }),
  };
});

export const createDefaultRequest = () => createMapRequest('Make a map of India');
