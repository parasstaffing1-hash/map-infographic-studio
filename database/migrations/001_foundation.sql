CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE geo_sources (
  id TEXT PRIMARY KEY,
  organization TEXT NOT NULL,
  source_url TEXT NOT NULL,
  license TEXT,
  dataset_version TEXT,
  downloaded_at TIMESTAMPTZ,
  official BOOLEAN NOT NULL DEFAULT FALSE,
  processing_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  checksum TEXT,
  quality_score NUMERIC(5,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE geo_boundary_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL REFERENCES geo_sources(id),
  version_label TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  geometry_srid INTEGER NOT NULL DEFAULT 4326,
  checksum TEXT,
  quality_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, version_label)
);

CREATE TABLE geo_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  name_hi TEXT,
  entity_type TEXT NOT NULL,
  country_code CHAR(2),
  state_id UUID REFERENCES geo_entities(id),
  district_id UUID REFERENCES geo_entities(id),
  subdistrict_id UUID REFERENCES geo_entities(id),
  parent_id UUID REFERENCES geo_entities(id),
  geometry_id UUID,
  centroid GEOGRAPHY(Point, 4326),
  bbox GEOGRAPHY(Polygon, 4326),
  area_sq_m DOUBLE PRECISION,
  population BIGINT,
  lgd_code TEXT,
  census_code TEXT,
  osm_id TEXT,
  wikidata_id TEXT,
  geonames_id TEXT,
  eci_id TEXT,
  official_code TEXT,
  valid_from DATE,
  valid_to DATE,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  source_id TEXT REFERENCES geo_sources(id),
  confidence NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE geo_names (
  entity_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  language_code TEXT,
  name_kind TEXT NOT NULL DEFAULT 'canonical',
  PRIMARY KEY (entity_id, name, name_kind)
);

CREATE TABLE geo_aliases (
  entity_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language_code TEXT,
  PRIMARY KEY (entity_id, normalized_alias)
);

CREATE TABLE geo_hierarchy (
  ancestor_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  descendant_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'contains',
  depth INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id, relation_type)
);

CREATE TABLE geo_boundaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  boundary_version_id UUID NOT NULL REFERENCES geo_boundary_versions(id),
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  geom_simplified GEOMETRY(MultiPolygon, 4326),
  zoom_min SMALLINT,
  zoom_max SMALLINT,
  UNIQUE (entity_id, boundary_version_id, zoom_min, zoom_max)
);

CREATE TABLE geo_neighbors (
  entity_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  neighbor_id UUID NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  shared_length_m DOUBLE PRECISION,
  PRIMARY KEY (entity_id, neighbor_id)
);

CREATE TABLE roads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  name TEXT,
  road_class TEXT,
  geom GEOMETRY(MultiLineString, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE railways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  name TEXT,
  rail_class TEXT,
  geom GEOMETRY(MultiLineString, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE rivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  name TEXT,
  stream_order INTEGER,
  geom GEOMETRY(MultiLineString, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE water (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  name TEXT,
  water_type TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE landuse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  class TEXT NOT NULL,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE forests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  name TEXT,
  protection_status TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES geo_entities(id),
  source_id TEXT REFERENCES geo_sources(id),
  settlement_type TEXT,
  population BIGINT,
  geom GEOMETRY(Point, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE pois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT REFERENCES geo_sources(id),
  name TEXT,
  category TEXT,
  geom GEOMETRY(Point, 4326) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE demographics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES geo_entities(id),
  period TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  numeric_value DOUBLE PRECISION,
  source_id TEXT REFERENCES geo_sources(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (entity_id, period, metric_key)
);

CREATE TABLE economic_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES geo_entities(id),
  period TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  numeric_value DOUBLE PRECISION,
  source_id TEXT REFERENCES geo_sources(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (entity_id, period, metric_key)
);

CREATE TABLE custom_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  name TEXT NOT NULL,
  source_id TEXT REFERENCES geo_sources(id),
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  member_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, member_id)
);

CREATE TABLE workspace_permissions (
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id, permission_key)
);

ALTER TABLE custom_datasets
  ADD CONSTRAINT custom_datasets_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE;

CREATE TABLE map_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  map_request JSONB NOT NULL,
  viewport JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  interaction_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE map_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  layer_key TEXT NOT NULL,
  layer_order INTEGER NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  opacity NUMERIC(4,3) NOT NULL DEFAULT 1,
  style JSONB NOT NULL DEFAULT '{}'::jsonb,
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_source JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (project_id, layer_key)
);

CREATE TABLE map_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  layer_id UUID REFERENCES map_layers(id) ON DELETE CASCADE,
  style JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE map_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  annotation_type TEXT NOT NULL,
  geometry GEOMETRY(Geometry, 4326),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE map_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  layer_key TEXT NOT NULL,
  filter_spec JSONB NOT NULL
);

CREATE TABLE saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE political_constituencies (
  entity_id UUID PRIMARY KEY REFERENCES geo_entities(id) ON DELETE CASCADE,
  constituency_number INTEGER,
  reservation_category TEXT,
  election_boundary_version_id UUID REFERENCES geo_boundary_versions(id)
);

CREATE TABLE political_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE political_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID REFERENCES political_parties(id),
  display_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE election_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constituency_entity_id UUID NOT NULL REFERENCES political_constituencies(entity_id),
  election_year INTEGER NOT NULL,
  candidate_id UUID REFERENCES political_candidates(id),
  party_id UUID REFERENCES political_parties(id),
  votes BIGINT,
  vote_share NUMERIC(7,4),
  turnout NUMERIC(7,4),
  electors BIGINT,
  margin_votes BIGINT,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  source_id TEXT REFERENCES geo_sources(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (constituency_entity_id, election_year, candidate_id)
);

CREATE INDEX geo_entities_name_trgm_idx ON geo_entities USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX geo_entities_type_idx ON geo_entities (entity_type);
CREATE INDEX geo_entities_parent_idx ON geo_entities (parent_id);
CREATE INDEX geo_entities_centroid_idx ON geo_entities USING GIST (centroid);
CREATE INDEX geo_boundaries_geom_idx ON geo_boundaries USING GIST (geom);
CREATE INDEX geo_boundaries_entity_idx ON geo_boundaries (entity_id);
CREATE INDEX geo_hierarchy_desc_idx ON geo_hierarchy (descendant_id);
CREATE INDEX election_results_year_idx ON election_results (election_year);
CREATE INDEX election_results_constituency_idx ON election_results (constituency_entity_id);
