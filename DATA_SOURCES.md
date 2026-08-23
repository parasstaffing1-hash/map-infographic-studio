# Data sources

## Demo sources

| ID | Source | Use | Caveat |
| --- | --- | --- | --- |
| `gadm-4.1` | GADM 4.1 | Uttarakhand and district context | Context-only; verify official administrative boundaries before production publication. |
| `datameet-india-ac` | DataMeet India Assembly Constituencies | 70 Uttarakhand Assembly boundary features | Open electoral boundary source; verify against the current official delimitation. |
| `osm-nominatim-ramnagar` | OpenStreetMap Nominatim | Ramnagar place resolution metadata | Used for place context, not canonical political geometry. |
| `census-2011-city-dataset` | IndianCities dataset | Top-100 city point fixture derived from Census 2011 population fields | Ranking source is open/community-maintained; verify against official Census tables before production publication. |
| `natural-earth-world` | Natural Earth low-resolution world context | Country-scale maps and viewport fitting | Context-only; use authoritative national boundary versions for production analysis. |

The downloaded provenance manifest is `public/data/provenance.json`. The app does not claim that demo open data is an official election result source.
