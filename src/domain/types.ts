import { z } from 'zod';

export const MapRequestSchema = z.object({
  query: z.string().min(1),
  place: z.string().optional(),
  parentGeography: z.string().optional(),
  countryCode: z.string().default('IN'),
  entityType: z.enum(['country', 'state', 'district', 'county', 'prefecture', 'city', 'town', 'assembly_constituency', 'lok_sabha_constituency', 'state_legislative_district', 'congressional_district', 'npc_electoral_unit', 'custom_region']),
  mapType: z.enum(['general', 'political', 'demographic', 'tourism', 'comparison', 'infographic']),
  subdivision: z.string().optional(),
  interactionMode: z.enum(['interactive', 'static']).default('interactive'),
  layers: z.array(z.string()).default(['auto']),
  filters: z.array(z.object({ field: z.string(), operator: z.string(), value: z.union([z.string(), z.number()]) })).default([]),
  style: z.enum(['clean', 'political', 'election', 'infographic', 'presentation', 'research', 'minimal', 'dark', 'light']).default('clean'),
  output: z.enum(['interactive', 'png', 'svg', 'pdf']).default('interactive'),
  timePeriod: z.string().optional(),
  viewport: z.object({ center: z.tuple([z.number(), z.number()]).optional(), zoom: z.number().optional(), fitEntity: z.string().optional() }).default({}),
});

export type MapRequest = z.infer<typeof MapRequestSchema>;

export type ViewMode = 'world' | 'india' | 'usa' | 'china' | 'india-districts' | 'india-assembly' | 'india-parliament' | 'usa-counties' | 'usa-state-house' | 'usa-congress' | 'china-prefectures' | 'china-counties' | 'china-npc' | 'delhi-districts' | 'delhi-assembly' | 'jammu-kashmir' | 'state' | 'district' | 'assembly' | 'cities' | 'place';
export type EditorMode = 'viewer' | 'editor';

export type GeoFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
};

export type GeoFeatureCollection = {
  type: 'FeatureCollection';
  features: GeoFeature[];
};

export type ResolvedEntity = {
  id: string;
  name: string;
  entityType: MapRequest['entityType'];
  parentName: string;
  districtName?: string;
  centroid?: [number, number];
  sourceId: string;
  confidence: number;
  metadata: Record<string, string | number | undefined>;
};

export type FilterSpec = {
  id: string;
  label: string;
  field: 'margin' | 'turnout' | 'party' | 'district';
  operator: '<' | '>' | '=';
  value: string;
  active: boolean;
};

export type StyleSpec = {
  fill: string;
  line: string;
  opacity: number;
  lineWidth: number;
  labelField: string;
  theme: 'light' | 'dark';
};

export type EditorCommand =
  | { type: 'set-view'; viewMode: ViewMode }
  | { type: 'set-layer'; layer: 'districts' | 'roads'; visible: boolean }
  | { type: 'select-color'; color: string }
  | { type: 'set-filter'; filter: FilterSpec }
  | { type: 'fit-place'; place: string }
  | { type: 'presentation-ready' }
  | { type: 'export'; format: 'png' };

export type ProvenanceSource = {
  id: string;
  organization: string;
  reference: string;
  license: string;
  quality: string;
};
