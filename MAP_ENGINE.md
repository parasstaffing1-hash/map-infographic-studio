# Map engine

MapLibre GL JS is the primary interactive renderer. The current canvas uses an OSM raster context layer and local GeoJSON boundary sources; the source boundary is added as a data-driven fill, outline, and label layer.

The future tile contract is intentionally compatible with the current source shape: each feature has a stable ID, human-readable properties, and a source ID. The map project can therefore switch from GeoJSON to vector tiles without changing editor semantics.

Use deck.gl for large points, heatmaps, hexagons, flows, and extrusions. Use D3/d3-geo for static SVG/infographic export. Interactive and static output should consume the same project snapshot.
