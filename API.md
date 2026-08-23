# API contract

The current app runs as a static vertical slice. The following REST boundary is the target for the FastAPI service:

```text
GET  /geo/search?q=&type=&parent=
GET  /geo/entities/{id}
GET  /geo/entities/{id}/children
GET  /geo/entities/{id}/neighbors
GET  /geo/entities/{id}/geometry
POST /map/resolve
POST /map/compose
GET  /map/projects
POST /map/projects
PATCH /map/projects/{id}
POST /map/projects/{id}/share
POST /map/projects/{id}/export
GET  /data/datasets
POST /data/join
GET  /political/elections
GET  /political/constituencies
GET  /political/results
```

`POST /map/resolve` accepts a validated `MapRequest` and returns resolved entities, boundary versions, recommended layers, viewport, and provenance. It does not accept arbitrary SQL or geometry from the client.
