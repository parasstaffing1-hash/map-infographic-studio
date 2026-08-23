# Geographic data pipeline

The demo pipeline is `npm run prepare:data` and is intentionally repeatable. It fetches source data, filters it to Uttarakhand, converts the DataMeet shapefile into GeoJSON, and writes provenance metadata.

The production pipeline should be implemented as:

```text
source download
 -> checksum + license capture
 -> CRS normalization
 -> geometry validation / repair
 -> duplicate and topology checks
 -> entity and parent matching
 -> immutable canonical boundary version
 -> zoom-specific simplification
 -> vector tiles / PMTiles
 -> publish with quality report
```

The master geometry must not be simplified destructively. Every derivative keeps a reference to its boundary version and processing parameters.
