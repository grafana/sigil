# Sigil API

Active contracts exposed by the service:

- Generation ingest gRPC:
  - `sigil.v1.GenerationIngestService.ExportGenerations`
- Generation ingest HTTP parity:
  - `POST /api/v1/generations:export`
- Query API:
  - `POST /api/v1/conversations:batch-metadata`
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/generations/{generation_id}`
  - `POST /api/v1/conversations/{conversation_id}/ratings`
  - `GET /api/v1/conversations/{conversation_id}/ratings`
  - `POST /api/v1/conversations/{conversation_id}/annotations`
  - `GET /api/v1/conversations/{conversation_id}/annotations`
  - `GET /api/v1/model-cards`
  - `GET /api/v1/model-cards:lookup`
  - `GET /api/v1/model-cards:sources`
  - `POST /api/v1/model-cards:refresh`
