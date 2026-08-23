# Data model

The initial PostGIS model is defined in [`database/migrations/001_foundation.sql`](database/migrations/001_foundation.sql).

Core relationships:

```text
geo_sources -> geo_boundary_versions -> geo_boundaries -> geo_entities
geo_entities -> geo_hierarchy -> geo_entities
geo_entities -> political_constituencies -> election_results
workspace -> map_projects -> map_layers / map_filters / map_annotations
```

Entities are identified independently from names. A town, tehsil, municipality, and Assembly constituency with the same label remain separate records. Boundary versions include validity windows and source checksums so historical comparisons do not overwrite current geography.

The browser fixture adapter maps external source properties into stable `feature.id`, `__name`, `__district`, `__source`, and `__viewMode` fields. This mirrors the API contract that a PostGIS-backed service will expose.
